import { ModelsSchema } from './schema';
import type { Model } from './types';
import rawModels from '../data/models.json';

export const models: Model[] = ModelsSchema.parse(rawModels);
