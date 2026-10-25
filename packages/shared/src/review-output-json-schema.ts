import { zodToJsonSchema } from 'zod-to-json-schema';
import { ReviewOutputSchema } from './api.js';

export const ReviewOutputJsonSchema = zodToJsonSchema(ReviewOutputSchema, {
  name: 'ReviewOutput',
  $refStrategy: 'none',
  target: 'jsonSchema7',
});
