import { Queue } from 'bullmq';

const connection = {
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
};

export const leadScoringQueue = new Queue('lead-scoring', { connection });
export const followupScheduleQueue = new Queue('followup-schedule', { connection });
export const whatsappSendQueue = new Queue('whatsapp-send', { connection });
export const emailSendQueue = new Queue('email-send', { connection });
export const replyClassifyQueue = new Queue('reply-classify', { connection });
export const voiceProcessQueue = new Queue('voice-process', { connection });
export const contentPublishQueue = new Queue('content-publish', { connection });
export const propertySyncQueue = new Queue('property-sync', { connection });
export const vectorSyncQueue = new Queue('vector-sync', { connection });
export const monitoringQueue = new Queue('monitoring', { connection });