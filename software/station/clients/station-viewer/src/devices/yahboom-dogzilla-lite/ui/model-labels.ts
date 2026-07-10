import { yahboom_dogzilla_lite } from '@/api/proto.js';

export function getYahboomDogzillaLiteModelLabel(model: number | null | undefined) {
  switch (model) {
    case yahboom_dogzilla_lite.YahboomDogzillaLiteModel.YAHBOOM_DOGZILLA_LITE:
      return 'Yahboom Dogzilla Lite';
    case yahboom_dogzilla_lite.YahboomDogzillaLiteModel.YAHBOOM_DOGZILLA_LITE_MINI:
      return 'Yahboom Dogzilla Mini';
    case yahboom_dogzilla_lite.YahboomDogzillaLiteModel.YAHBOOM_DOGZILLA_LITE_PRO:
      return 'Yahboom Dogzilla Pro';
    case yahboom_dogzilla_lite.YahboomDogzillaLiteModel.YAHBOOM_DOGZILLA_LITE_RIDER:
      return 'Yahboom Dogzilla Rider';
    default:
      return 'Unknown';
  }
}
