import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import { AzureDevOpsService } from './AzureDevOpsService';

export class MetadataService extends AzureDevOpsService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  /**
   * List the work item types available in the project (Task, Bug, Epic…).
   */
  public async getWorkItemTypes(): Promise<any[]> {
    const witApi = await this.getWorkItemTrackingApi();
    return witApi.getWorkItemTypes(this.config.project);
  }

  /**
   * List the fields of the project, with the reference name queries take.
   */
  public async getFields(): Promise<any[]> {
    const witApi = await this.getWorkItemTrackingApi();
    return witApi.getFields(this.config.project);
  }

  /**
   * List the tags defined in the project.
   */
  public async getTags(): Promise<any[]> {
    const witApi = await this.getWorkItemTrackingApi();
    return witApi.getTags(this.config.project);
  }
}
