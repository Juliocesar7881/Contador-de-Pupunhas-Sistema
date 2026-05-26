export type PalletStatus = 'processing' | 'done' | 'error';

export type Load = {
  id: number;
  name: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  total_count: number;
};

export type LoadSummary = Load & {
  pallet_count: number;
};

export type Pallet = {
  id: number;
  load_id: number;
  pallet_number: number;
  name: string;
  original_image_base64: string;
  ai_image_base64: string | null;
  ai_count: number;
  manual_count: number | null;
  final_count: number;
  status: PalletStatus;
  error_message: string | null;
  predictions_json: string | null;
  created_at: string;
  updated_at: string;
};

export type RoboflowPrediction = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
  class_id: number;
  detection_id: string;
};

export type RoboflowAnalysis = {
  count: number;
  outputImageBase64: string | null;
  predictions: RoboflowPrediction[];
};

export type PendingPickerContext = {
  loadId: number;
  source: 'camera' | 'gallery';
  palletName: string;
};
