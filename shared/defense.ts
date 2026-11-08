export interface DefenseEvent {
  at: string;
  channel: string;
  text: string;
}
export interface DefenseJob {
  command: string;
  status: 'running' | 'passed' | 'failed';
  passed: number;
  failed: number;
  exitCode: number | null;
  lines: string[];
}
export interface DefenseState {
  enabled: boolean;
  runId: string;
  phase: 'idle' | 'deploying' | 'provisioning' | 'ready' | 'failed';
  startedAt: string | null;
  error: string;
  events: DefenseEvent[];
  jobs: Record<string, DefenseJob>;
  contracts: {
    name: string;
    address: string;
    hash: string;
    block: string;
    bytecodeBytes: number;
  }[];
  project: { id: string; title: string } | null;
  depositHash: string | null;
}
