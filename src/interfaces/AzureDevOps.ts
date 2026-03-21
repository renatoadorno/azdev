import type { EntraAuthHandler } from "../services/EntraAuthHandler";

/**
 * Defines the possible authentication types for Azure DevOps.
 */
export type AzureDevOpsAuthType = 'pat' | 'ntlm' | 'basic' | 'entra';

/**
 * Configuration for Personal Access Token (PAT) authentication.
 */
export interface PatAuth {
  type: 'pat';
}

/**
 * Configuration for NTLM authentication.
 */
export interface NtlmAuth {
  type: 'ntlm';
  username: string;
  password: string;
  domain?: string;
}

/**
 * Configuration for Basic authentication.
 */
export interface BasicAuth {
  type: 'basic';
  username: string;
  password: string;
}

/**
 * Configuration for Azure Identity (Entra/DefaultAzureCredential) authentication.
 */
export interface AzureIdentityAuth {
  type: 'entra';
}

/**
 * Union type for all possible Azure DevOps authentication configurations.
 */
export type AzureDevOpsAuthConfig = PatAuth | NtlmAuth | BasicAuth | AzureIdentityAuth;

/**
 * Interface for Azure DevOps configuration
 */
export interface AzureDevOpsConfig {
  orgUrl: string;
  project: string;
  personalAccessToken: string;
  isOnPremises?: boolean;
  collection?: string; // Collection name for on-premises
  apiVersion?: string; // API version for on-premises
  auth?: AzureDevOpsAuthConfig; // Updated to use the new union type
  entraAuthHandler?: EntraAuthHandler;
}

