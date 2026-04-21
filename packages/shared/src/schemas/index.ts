import { z } from 'zod';

// ---- Auth -----------------------------------------------------------------

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  role: z.enum(['admin', 'user', 'agent']).default('user'),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;

// ---- Campaign -------------------------------------------------------------

export const RetryRuleSchema = z.object({
  maxAttempts: z.number().int().min(0).max(10),
  delayMinutes: z.number().int().min(1).max(10080), // max 1 week
});

export const CreateCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  dialMode: z.enum(['preview', 'progressive', 'predictive']).default('progressive'),
  concurrency: z.number().int().min(1).max(500).default(5),
  ratePerSecond: z.number().min(0.1).max(100).default(1),
  retryRules: z
    .object({
      busy: RetryRuleSchema,
      noAnswer: RetryRuleSchema,
      failed: RetryRuleSchema,
    })
    .default({
      busy: { maxAttempts: 3, delayMinutes: 5 },
      noAnswer: { maxAttempts: 3, delayMinutes: 30 },
      failed: { maxAttempts: 1, delayMinutes: 60 },
    }),
  amdAction: z.enum(['hangup', 'continue']).default('hangup'),
  ivrFlowId: z.string().optional(),
  agentPool: z.array(z.string()).default([]),
  timezone: z.string().default('UTC'),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Must be HH:MM format')
    .optional(),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Must be HH:MM format')
    .optional(),
  blackoutDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'))
    .default([]),
  callerIdName: z.string().min(1).max(100),
  callerIdNumber: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/, 'Must be a valid phone number'),
  sipTrunk: z.string().min(1, 'SIP trunk is required'),
});

export const UpdateCampaignSchema = CreateCampaignSchema.partial();

export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>;

// ---- Contact --------------------------------------------------------------

export const CreateContactSchema = z.object({
  campaignId: z.string().min(1),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Must be a valid E.164 phone number'),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional(),
  customFields: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export type CreateContactInput = z.infer<typeof CreateContactSchema>;

// ---- Agent ----------------------------------------------------------------

export const CreateAgentSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(100),
  extension: z.string().min(1).max(20),
  sipEndpoint: z
    .string()
    .min(1)
    .describe('Asterisk endpoint e.g. PJSIP/1001'),
  campaignIds: z.array(z.string()).default([]),
  maxConcurrentCalls: z.number().int().min(1).max(10).default(1),
});

export const UpdateAgentSchema = CreateAgentSchema.partial().extend({
  status: z.enum(['available', 'busy', 'offline', 'break']).optional(),
});

export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;

// ---- IVR Flow -------------------------------------------------------------

export const IvrStepBranchSchema = z.object({
  digit: z.string().min(1),
  nextStepId: z.string().min(1),
});

export const IvrStepSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'start',
    'play',
    'dtmf_collect',
    'route_agent',
    'transfer',
    'webhook',
    'hangup',
    'condition',
  ]),
  label: z.string().optional(),
  // play
  audioFile: z.string().optional(),
  audioText: z.string().optional(),
  // dtmf_collect
  timeoutSeconds: z.number().int().min(1).max(60).optional(),
  maxDigits: z.number().int().min(1).max(20).optional(),
  interDigitTimeoutSeconds: z.number().int().min(1).max(10).optional(),
  branches: z.array(IvrStepBranchSchema).optional(),
  // route_agent
  agentPool: z.array(z.string()).optional(),
  agentSelectionStrategy: z
    .enum(['round_robin', 'least_busy', 'random'])
    .optional(),
  // transfer (SIP forward to external number / 3CX ring group)
  transferTo: z.string().optional(),
  transferTrunk: z.string().optional(),
  // webhook
  webhookUrl: z.string().url().optional(),
  webhookMethod: z.enum(['GET', 'POST']).optional(),
  webhookHeaders: z.record(z.string()).optional(),
  webhookPayloadTemplate: z.string().optional(),
  webhookTimeoutSeconds: z.number().int().min(1).max(30).optional(),
  webhookSuccessNextStepId: z.string().optional(),
  webhookFailureNextStepId: z.string().optional(),
  // condition
  variable: z.string().optional(),
  conditionBranches: z.array(IvrStepBranchSchema).optional(),
  // linear next
  nextStepId: z.string().optional(),
  // React Flow position
  position: z
    .object({ x: z.number(), y: z.number() })
    .optional(),
});

export const CreateIvrFlowSchema = z.object({
  name: z.string().min(1).max(255),
  campaignId: z.string().min(1),
  entryStepId: z.string().min(1),
  steps: z.array(IvrStepSchema).min(1),
});

export const UpdateIvrFlowSchema = CreateIvrFlowSchema.partial();

export type CreateIvrFlowInput = z.infer<typeof CreateIvrFlowSchema>;
export type UpdateIvrFlowInput = z.infer<typeof UpdateIvrFlowSchema>;

// ---- DNC ------------------------------------------------------------------

export const AddDncSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Must be a valid phone number'),
  reason: z.string().max(500).optional(),
  source: z
    .enum(['manual', 'csv', 'opted_out', 'internal'])
    .default('manual'),
});

export const CheckDncSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
});

export type AddDncInput = z.infer<typeof AddDncSchema>;

// ---- Pagination -----------------------------------------------------------

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationInput = z.infer<typeof PaginationSchema>;
