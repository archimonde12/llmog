import { z } from "zod";

export const ModelAdapterTypeSchema = z.enum(["ollama", "openai_compatible", "deepseek"]);

export const ModelConfigSchema = z.object({
  id: z.string().min(1, "Required"),
  adapter: ModelAdapterTypeSchema,
  baseUrl: z
    .string()
    .min(1, "Required")
    .refine(
      (v) => {
        try {
          // eslint-disable-next-line no-new
          new URL(v);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid URL (must include protocol, e.g. http://localhost:11434)" },
    ),
  model: z.string().min(1, "Required"),
  apiKey: z.string().min(1).optional(),
  apiKeyHeader: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
})
  .superRefine((val, ctx) => {
    if (val.apiKeyHeader && !val.apiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKey"],
        message: "Required when apiKeyHeader is set",
      });
    }
  });

export const ModelsFileSchema = z
  .object({
    models: z.array(ModelConfigSchema).min(1, "Must include at least 1 model"),
  })
  .superRefine((val, ctx) => {
    const seen = new Map<string, number>();
    for (let i = 0; i < val.models.length; i++) {
      const id = val.models[i]?.id;
      if (!id) continue;
      const prev = seen.get(id);
      if (prev !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["models", i, "id"],
          message: `Duplicate id '${id}' (also at models[${prev}].id)`,
        });
      } else {
        seen.set(id, i);
      }
    }
  });

export type ModelAdapterType = z.infer<typeof ModelAdapterTypeSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ModelsFile = z.infer<typeof ModelsFileSchema>;

