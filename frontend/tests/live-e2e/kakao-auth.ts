import { expect, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/** Only for isolated local integration servers with a dedicated test bot and secret. */
export async function signupKakao(context: BrowserContext, name: string): Promise<string> {
  const secret = process.env.TAGBACK_TEST_KAKAO_SKILL_SECRET;
  const botId = process.env.TAGBACK_TEST_KAKAO_BOT_ID;
  if (!secret || !botId) throw new Error('Isolated Kakao test bot and skill secret are required.');
  const request = context.request;
  const issued = await request.post('/api/v1/auth/kakao/challenges', { data: { purpose: 'SIGNUP' } });
  expect(issued.status(), await issued.text()).toBe(201);
  const { id, code } = await issued.json();
  const skill = await request.post('/api/v1/auth/kakao/skill', { headers: { 'X-Tagback-Skill-Secret': secret },
    data: { bot: { id: botId }, userRequest: { utterance: code, user: { type: 'botUserKey', id: randomUUID() } } } });
  expect(skill.status(), await skill.text()).toBe(200);
  const status = await request.get(`/api/v1/auth/kakao/challenges/${id}`);
  expect((await status.json()).status).toBe('VERIFIED');
  const created = await request.post('/api/v1/auth/kakao/signup', { data: { challengeId: id, pin: '048259', profile: { name, occupation: '학생' } },
    headers: { 'Idempotency-Key': randomUUID() } });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).user.userId as string;
}

export async function registeredLogin(context: BrowserContext) {
  const response = await context.request.post('/api/v1/auth/login/registered', { data: { pin: '048259' }, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.ok(), await response.text()).toBeTruthy();
}
