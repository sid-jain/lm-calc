import { z } from 'zod';

export const ModelSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    displayName: z.string().min(1),
    family: z.string().min(1),
    developer: z.string().min(1),
    hfRepo: z.string().regex(/^[^/]+\/[^/]+$/),
    params: z.number().positive(),
    isMoE: z.boolean(),
    activeParams: z.number().positive().nullable(),
    arch: z.object({
      layers: z.number().int().positive(),
      attnHeads: z.number().int().positive(),
      kvHeads: z.number().int().positive(),
      headDim: z.number().int().positive(),
      hiddenSize: z.number().int().positive(),
      vocabSize: z.number().int().positive(),
      tiedEmbeddings: z.boolean(),
      maxContext: z.number().int().positive(),
      attentionType: z.enum(['full', 'gqa', 'mqa', 'mixed']),
      slidingWindowSize: z.number().int().positive().nullable(),
      fullAttentionRatio: z.number().min(0).max(1).nullable(),
    }),
  })
  .refine((m) => m.arch.kvHeads <= m.arch.attnHeads, 'kvHeads cannot exceed attnHeads')
  .refine(
    (m) =>
      m.arch.attentionType !== 'mixed' ||
      (m.arch.slidingWindowSize !== null && m.arch.fullAttentionRatio !== null),
    'mixed attention requires slidingWindowSize and fullAttentionRatio',
  )
  .refine((m) => !m.isMoE || m.activeParams !== null, 'MoE models require activeParams');

export const ModelsSchema = z.array(ModelSchema);
