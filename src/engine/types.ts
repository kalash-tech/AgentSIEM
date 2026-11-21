export type EventType = 'INPUT_LOG' | 'THOUGHT_LOG' | 'TOOL_CALL';

export type CaseStatus = 'NOMINAL' | 'ALERT_BLOCKED' | 'RESOLVED';

export type RuleSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM';

export type RuleMatchField = 'content' | 'target' | 'tool_name' | 'any';

export interface FlightEvent {
  id: string;
  trace_id: string;
  agent: string;
  step: number;
  event_type: EventType;
  action: string;
  content?: string;
  tool_name?: string;
  target?: string;
  timestamp: string;
  blocked?: boolean;
}

export interface SecurityRule {
  id: string;
  name: string;
  description: string;
  severity: RuleSeverity;
  field: RuleMatchField;
  pattern: string;
  mode: 'contains' | 'regex' | 'allowlist_extension';
  enabled: boolean;
  source: 'Baseline' | 'Gemini Auto-Rule' | 'Custom';
  createdAt: string;
  hits: number;
}

export interface RuleHit {
  ruleId: string;
  ruleName: string;
  severity: RuleSeverity;
  step: number;
  field: RuleMatchField;
  matchedValue: string;
  reason: string;
}

export interface AnomalyAssessment {
  score: number; // 0 to 100
  isAnomaly: boolean;
  baselineReadCalls: number;
  observedReadCalls: number;
  baselineExternalCalls: number;
  observedExternalCalls: number;
  deviations: string[];
}

export interface VectorSignature {
  id: string;
  label: string;
  category: string;
  samplePhrase: string;
  keywords: string[];
  severity: RuleSeverity;
}

export interface VectorMatch {
  signatureId: string;
  label: string;
  category: string;
  similarityPercent: number; // 0-100
  isMatch: boolean;
  matchedSnippet: string;
}

export interface ForensicReport {
  generatedAt: string;
  model: string;
  attackSummary: string;
  rootCause: string;
  maliciousLine: string;
  impactAssessment: string;
  recommendedAction: string;
  generatedRule: {
    name: string;
    description: string;
    severity: RuleSeverity;
    field: RuleMatchField;
    pattern: string;
    mode: 'contains' | 'regex';
  };
  savedRuleId?: string;
}

export interface AgentCase {
  trace_id: string;
  agent: string;
  fileName: string;
  createdAt: string;
  status: CaseStatus;
  pausedBeforeExfiltration: boolean;
  events: FlightEvent[];
  ruleHits: RuleHit[];
  anomaly: AnomalyAssessment;
  vectorMatch: VectorMatch;
  forensicReport?: ForensicReport;
  maliciousHighlight?: string;
}

export interface BaselineProfile {
  agent: string;
  allowedExtensions: string[];
  avgReadFileCalls: number;
  avgExternalCalls: number;
  similarityThreshold: number;
  normalTools: string[];
}

export interface ResumeScenario {
  id: string;
  title: string;
  fileName: string;
  kind: 'clean' | 'poisoned';
  summary: string;
  content: string;
}
