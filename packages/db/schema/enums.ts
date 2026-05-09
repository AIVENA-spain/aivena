import { pgEnum } from 'drizzle-orm/pg-core';

export const leadStatusEnum = pgEnum('lead_status', [
  'active', 'paused', 'archived', 'blacklisted',
]);

export const pipelineStageEnum = pgEnum('pipeline_stage', [
  'new', 'qualified', 'engaged',
  'booking_requested', 'booking_confirmed',
  'closed_won', 'cold', 'lost', 'on_hold',
]);

export const temperatureEnum = pgEnum('temperature', [
  'cold', 'warm', 'hot', 'super_hot', 'unknown',
]);

export const optInStatusEnum = pgEnum('opt_in_status', [
  'opted_in', 'opted_out', 'unknown', 'pending',
]);

export const sendStatusEnum = pgEnum('send_status', [
  'queued', 'processing', 'sent', 'delivered',
  'failed', 'expired', 'cancelled', 'rejected', 'dead',
]);

export const taskStatusEnum = pgEnum('task_status', [
  'pending', 'assigned', 'actioned', 'closed', 'dismissed', 'expired', 'failed',
]);

export const bookingStatusEnum = pgEnum('booking_status', [
  'requested', 'confirmed', 'cancelled', 'rescheduled', 'completed', 'no_show',
]);

export const contentStatusEnum = pgEnum('content_status', [
  'draft', 'pending_approval', 'approved', 'rejected',
  'scheduled', 'published', 'archived', 'failed',
]);

export const contentTypeEnum = pgEnum('content_type', [
  'social_post', 'listing_description', 'email_campaign',
  'reel_script', 'ad_copy', 'carousel', 'story', 'video_caption',
]);

export const callStatusEnum = pgEnum('call_status', [
  'ringing', 'answered', 'no_answer', 'busy', 'failed', 'voicemail',
]);