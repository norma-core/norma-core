import featureFlags from '@/features.json';

export const FEATURE_FLAGS = featureFlags as Readonly<{
  chat: boolean;
}>;
