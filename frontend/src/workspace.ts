import type { DataFile } from "./App";
import type { BinSettings, CodeInputs } from "./variablesPlan";

// 새로고침하거나 창을 닫았다 열어도 작업을 이어 하도록 지금 작업을 이 브라우저에 보관한다.
// 엑셀 파일 내용까지 들어가므로 용량 제한이 작은 localStorage 대신 IndexedDB를 쓴다.
export interface Workspace {
  dataFile: DataFile | null;
  tab?: string;
  // 변수 설정에서 코드를 적용하기 전에 입력하던 코드·라벨
  codeInputs?: { fileKey: string; inputs: CodeInputs; ordered?: string[] };
  // 스크리닝에서 반영하기 전에 고치던 값
  screening?: {
    fileKey: string;
    edits: Record<string, string>;
    reasons?: Record<string, string>;
    ran: boolean;
    useRules: boolean;
  };
  // 요약·코딩의 다운로드 변수 선택과 구간 설정
  summary?: {
    fileKey: string;
    bins: BinSettings;
    selected: string[];
    excludeOutOfRange: boolean;
  };
}

const DB_NAME = "clinical-screening";
const STORE = "workspace";
const KEY = "current";
const SAVE_DELAY = 300;

let current: Workspace = { dataFile: null };
let timer: ReturnType<typeof setTimeout> | undefined;

// 보관한 작업이 어느 파일의 것인지 확인하는 키 (다른 파일에 잘못 적용하지 않도록)
export const setupKey = (file: DataFile) =>
  `${file.name}:${file.rawSheet ?? file.info.sheet}`;
export const summaryKey = (file: DataFile) => `${file.name}:${file.info.sheet}`;
export const screeningKey = (file: DataFile) =>
  `${file.name}:${file.info.sheet}:${file.bytes.byteLength}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadWorkspace(): Promise<Workspace> {
  try {
    const db = await openDb();
    const saved = await new Promise<Workspace | undefined>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (saved) current = saved;
  } catch {
    // 개인정보 보호 모드 등 저장소를 쓸 수 없으면 빈 작업으로 시작
  }
  return current;
}

// 화면이 처음 열릴 때 보관된 값을 읽는다
export const savedWorkspace = () => current;

async function write() {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(current, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 보관에 실패해도 작업은 계속할 수 있다 (새로고침하면 사라질 뿐)
  }
}

// 입력할 때마다 쓰지 않도록 잠깐 모았다가 한 번에 보관한다
export function saveWorkspace(patch: Partial<Workspace>) {
  current = { ...current, ...patch };
  clearTimeout(timer);
  timer = setTimeout(write, SAVE_DELAY);
}

export function clearWorkspace() {
  current = { dataFile: null };
  clearTimeout(timer);
  void write();
}
