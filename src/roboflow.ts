import type { RoboflowAnalysis, RoboflowPrediction } from './types';

const ROBOFLOW_API_URL =
  'https://serverless.roboflow.com/loops-luchini/workflows/detect-count-and-visualize';
const ROBOFLOW_API_KEY = 'TDezmok4BGqtc1sKEXAk';
const ROBOFLOW_TIMEOUT_MS = 45000;
export const AI_CONFIDENCE_THRESHOLD = 0.15;

type RoboflowWorkflowResponse = {
  outputs?: Array<RoboflowWorkflowOutput>;
  message?: string;
  error_type?: string;
};

type RoboflowImageValue = {
  type?: string;
  value?: string;
  image?: RoboflowImageValue;
};

type RoboflowWorkflowOutput = {
    count_objects?: number | { output?: number };
    output_image?: {
      type?: string;
      value?: string;
      image?: RoboflowImageValue;
    };
    dot_visualization_output?: string | RoboflowImageValue;
    predictions?: {
      predictions?: RoboflowPrediction[];
    } | RoboflowPrediction[];
};

export function stripBase64Prefix(value: string) {
  return value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
}

export function imageDataUri(base64: string | null | undefined, mimeType = 'image/jpeg') {
  if (!base64) {
    return undefined;
  }

  if (base64.startsWith('data:image/')) {
    return base64;
  }

  return `data:${mimeType};base64,${base64}`;
}

function extractImageValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const imageValue = value as RoboflowImageValue;

  if (typeof imageValue.value === 'string') {
    return imageValue.value;
  }

  if (imageValue.image) {
    return extractImageValue(imageValue.image);
  }

  return null;
}

function extractOutputImage(output: RoboflowWorkflowOutput) {
  return extractImageValue(output.dot_visualization_output)
    ?? extractImageValue(output.output_image);
}

function extractPredictions(output: RoboflowWorkflowOutput) {
  if (Array.isArray(output.predictions)) {
    return output.predictions;
  }

  return output.predictions?.predictions ?? [];
}

function extractCount(output: RoboflowWorkflowOutput, predictionCount: number) {
  if (typeof output.count_objects === 'number') {
    return output.count_objects;
  }

  if (typeof output.count_objects?.output === 'number') {
    return output.count_objects.output;
  }

  return predictionCount;
}

async function parseRoboflowResponse(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as RoboflowWorkflowResponse;
  } catch {
    throw new Error('A IA retornou uma resposta invalida.');
  }
}

export async function analyzePalletImage(base64Image: string): Promise<RoboflowAnalysis> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ROBOFLOW_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(ROBOFLOW_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        api_key: ROBOFLOW_API_KEY,
        inputs: {
          image: {
            type: 'base64',
            value: stripBase64Prefix(base64Image),
          },
        },
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('A IA demorou demais para responder. Tente reprocessar este palete.');
    }

    throw new Error('Nao foi possivel conectar com a IA. Confira a internet e tente novamente.');
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await parseRoboflowResponse(response);

  if (!response.ok) {
    throw new Error(data.message || 'Nao foi possivel contar este palete.');
  }

  const output = data.outputs?.[0];

  if (!output) {
    throw new Error('A resposta da IA veio vazia.');
  }

  const predictions = extractPredictions(output);
  const count = extractCount(output, predictions.length);
  const outputImage = extractOutputImage(output);

  return {
    count,
    outputImageBase64: outputImage ? stripBase64Prefix(outputImage) : null,
    predictions,
  };
}
