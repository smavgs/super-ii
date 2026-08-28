export type BrowserAiTask =
  | 'audio-classification'
  | 'automatic-speech-recognition'
  | 'feature-extraction'
  | 'image-classification'
  | 'image-to-text'
  | 'text-classification'
  | 'text-generation'
  | 'token-classification';

export type BrowserAiRunner = {
  device: 'webgpu' | 'wasm';
  run: (input: unknown, options?: Record<string, unknown>) => Promise<unknown>;
  dispose: () => Promise<void>;
};

const SAFE_MODEL_PATH = /^[a-zA-Z0-9](?:[a-zA-Z0-9._/-]{0,510}[a-zA-Z0-9])?$/;

function validateModelPath(modelPath: string): string {
  if (
    !SAFE_MODEL_PATH.test(modelPath) ||
    modelPath.startsWith('/') ||
    modelPath.includes('..') ||
    modelPath.includes('://')
  ) {
    throw new Error('Browser AI requires a local Super ii model path.');
  }
  return modelPath;
}

export async function createBrowserAiRunner(
  task: BrowserAiTask,
  modelPath: string,
  onProgress?: (event: unknown) => void,
): Promise<BrowserAiRunner> {
  const localModel = validateModelPath(modelPath);
  const transformers = await import('@huggingface/transformers');

  transformers.env.allowRemoteModels = false;
  transformers.env.allowLocalModels = true;
  transformers.env.localModelPath = '/api/browser-models/';
  const wasmBackend = transformers.env.backends.onnx.wasm;
  if (!wasmBackend) throw new Error('Local ONNX WASM backend is unavailable.');
  wasmBackend.wasmPaths = '/runtime-assets/wasm/';

  const preferredDevice = 'gpu' in navigator ? 'webgpu' : 'wasm';
  let device: 'webgpu' | 'wasm' = preferredDevice;
  let runner;
  try {
    runner = await transformers.pipeline(task, localModel, {
      device,
      progress_callback: onProgress,
    });
  } catch (error) {
    if (device !== 'webgpu') throw error;
    device = 'wasm';
    runner = await transformers.pipeline(task, localModel, {
      device,
      progress_callback: onProgress,
    });
  }

  const callable = runner as unknown as (
    input: unknown,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  return {
    device,
    run: (input, options = {}) => callable(input, options),
    dispose: async () => {
      await runner.dispose();
    },
  };
}
