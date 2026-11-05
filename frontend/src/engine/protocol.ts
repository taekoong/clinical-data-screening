import type {
  CellEdit,
  CodingPlan,
  Rules,
  VariableType,
  Codebook,
} from "../types";

export type WorkerRequest =
  | { type: "init"; indexURL: string }
  | { type: "inspect"; id: number; data: Uint8Array; sheet?: string }
  | {
      type: "describe";
      id: number;
      data: Uint8Array;
      sheet: string;
      variables: Record<string, VariableType>;
      rules: Rules;
      excludeOutOfRange: boolean;
    }
  | {
      type: "exportVariables";
      id: number;
      data: Uint8Array;
      sheet: string;
      variables: Record<string, VariableType>;
      plan: CodingPlan;
      includeData: boolean;
      rules: Rules;
      excludeOutOfRange: boolean;
    }
  | { type: "validateRules"; id: number; rules: Rules }
  | {
      type: "previewRecode";
      id: number;
      data: Uint8Array;
      sheet: string;
      column: string;
      source: string;
      target: string;
    }
  | {
      type: "screen";
      id: number;
      data: Uint8Array;
      rules: Rules | null;
      sheet?: string;
    }
  | {
      type: "applyEdits";
      id: number;
      data: Uint8Array;
      sheet: string;
      edits: CellEdit[];
      changedAt: string;
    }
  | {
      type: "exportAnalysis";
      id: number;
      data: Uint8Array;
      sheet: string;
      codebook: Codebook;
    }
  | { type: "rScript"; id: number; fileName: string; codebook: Codebook };

export type WorkerResponse =
  | { type: "progress"; message: string }
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "result"; id: number; value: unknown }
  | { type: "error"; id: number; message: string };
