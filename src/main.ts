import * as core from '@actions/core'
import {getOctokit, context as GithubContext} from '@actions/github'
import {GitHub} from "@actions/github/lib/utils";
import {callWithRetry} from './utils'
import fs from 'fs';
import AdmZip from 'adm-zip';


const workflow_final_status : string[] = [
  "completed",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "success",
  "timed_out",
];

class Handler {
  private octokit: InstanceType<typeof GitHub>;
  private owner: string;
  private repo: string;
  private workflow_id: string;
  private workflow_ref: string;
  private inputs: any;
  private max_retry = 7;
  private retry_timeout = 5;
  private dispatch_time: any;
  private dispatch_name: string;
  private artifact_name: string;
  private download_path: string;

  constructor(
      token: string,
      owner: string,
      repo: string,
      workflow_id: string,
      workflow_ref: string,
      inputs: any,
      dispatch_name: string,
      artifact_name: string,
      download_path: string,
  ) {
    this.octokit = getOctokit(token);
    this.owner = owner;
    this.repo = repo;
    this.workflow_id = workflow_id;
    this.workflow_ref = workflow_ref;
    this.inputs = inputs;
    this.dispatch_name = dispatch_name;
    this.artifact_name = artifact_name;
    this.download_path = download_path;
  }

  async dispatch() {
    await this.octokit.rest.actions.createWorkflowDispatch({
      owner: this.owner,
      repo: this.repo,
      workflow_id: this.workflow_id,
      ref: this.workflow_ref,
      inputs: this.inputs,
    });
    this.dispatch_time = new Date();
  }

  async getWorkflowRunId(): Promise<number | undefined> {
      const _fetchWorkflowRun = async () => {
        const workflows = await this.octokit.rest.actions.listWorkflowRuns({
          owner: this.owner,
          repo: this.repo,
          workflow_id: this.workflow_id,
          created: `>${this.dispatch_time.toISOString()}`,
        });
        return workflows.data.workflow_runs.find(w => w.name === this.dispatch_name);
      };
      const workflow = await callWithRetry(_fetchWorkflowRun, this.max_retry, this.retry_timeout);
      return workflow && workflow.id;
  }

  async waitForWorkflowRunCompletion(run_id: number) {
    const _waitForWorkflowRunCompletion = async () => {
      const workflow = await this.octokit.rest.actions.getWorkflowRun({
        owner: this.owner,
        repo: this.repo,
        run_id,
      });
      if (!workflow || !workflow.data || !workflow.data.status) return null;
      if (workflow_final_status.includes(workflow.data.status)) {
        return workflow.data;
      }
      return null;
    };
    return await callWithRetry(_waitForWorkflowRunCompletion, 60, 60);
  }

  async downloadArtifact(run_id: number) {
      const _getWorkflowArtifact = async () => {
        const artifacts = await this.octokit.rest.actions.listWorkflowRunArtifacts({
          owner: this.owner,
          repo: this.repo,
          run_id,
        })
        if (!artifacts) return null;
        return artifacts.data.artifacts.find(a => a.name === this.artifact_name);
      }
      const artifact = await callWithRetry(_getWorkflowArtifact, this.max_retry, this.retry_timeout);
      if (!artifact) {
        throw new Error("Could not download artifact");
      }
      const zip = await this.octokit.rest.actions.downloadArtifact({
        owner: this.owner,
        repo: this.repo,
        artifact_id: artifact.id,
        archive_format: "zip"
      });
      fs.mkdirSync(this.download_path, { recursive: true });
      const adm = new AdmZip(Buffer.from(zip.data));
      adm.extractAllTo(this.download_path, true);
  }
}

function parse(inputsJson: string) {
  if(inputsJson) {
    try {
      return JSON.parse(inputsJson);
    } catch(e) {
      throw new Error(`Failed to parse 'inputs' parameter. Muse be a valid JSON.\nCause: ${e}`)
    }
  }
  return {}
}

export function getArgs() {
  // Required inputs
  const token = core.getInput('token');
  const [owner, repo] = core.getInput('repo')
      ? core.getInput('repo').split('/')
      : [GithubContext.repo.owner, GithubContext.repo.repo];
  const workflow_id = core.getInput('workflow_id');
  const workflow_ref = core.getInput('ref')   || GithubContext.ref;
  let inputs = parse(core.getInput('inputs'));
  const dispatch_name = core.getInput('dispatch_name');
  const artifact_name = core.getInput('artifact_name');
  const download_path = core.getInput('download_path');

  return {
    token,
    workflow_id,
    workflow_ref,
    owner,
    repo,
    inputs,
    dispatch_name,
    artifact_name,
    download_path
  };
}

export async function run(): Promise<void> {
  try {
    const args = getArgs();
    const handler = new Handler(
        args.token,
        args.owner,
        args.repo,
        args.workflow_id,
        args.workflow_ref,
        args.inputs,
        args.dispatch_name,
        args.artifact_name,
        args.download_path,
    );
    // 1. Dispatch workflow
    await handler.dispatch();
    // 2. Get workflow run id
    const run_id = await handler.getWorkflowRunId();
    if (!run_id) {
      throw new Error(`Could not infer run id`)
    }
    // 3. Wait for the workflow_completion
    await handler.waitForWorkflowRunCompletion(run_id);
    // 4. Download workflow artifact
    await handler.downloadArtifact(run_id);

  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
