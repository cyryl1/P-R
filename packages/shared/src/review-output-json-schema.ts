import { zodToJsonSchema } from 'zod-to-json-schema';
import { ReviewOutputWireSchema } from './api.js';

export const ReviewOutputJsonSchema = zodToJsonSchema(ReviewOutputWireSchema, {
  name: 'ReviewOutput',
  $refStrategy: 'none',
  target: 'jsonSchema7',
});
