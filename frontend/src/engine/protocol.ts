import type { CellEdit, Rules, VariableType } from "../types";

export type WorkerRequest =
  | { type: "init"; indexURL: string }
  | {
      type: "inspect";
      id: number;
      data: Uint8Array;
      sheet?: string;
      variableTypes?: Partial<Record<string, VariableType>>;
    }
  | { type: "validateRules"; id: number; rules: Rules }
  | { type: "previewRecode"; id: number; data: Uint8Array; sheet: string; column: string; source: string; target: string }
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
    };

export type WorkerResponse =
  | { type: "progress"; message: string }
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "result"; id: number; value: unknown }
  | { type: "error"; id: number; message: string };
