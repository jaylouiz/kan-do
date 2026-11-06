 
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'
import { isNotionStubEnabled } from '~/server/utils/notionStub'

// Mock the Notion stub utilities
vi.mock('~/server/utils/notionStub', () => ({
  getStubbedTasks: vi.fn(),
  isNotionStubEnabled: vi.fn(() => false),
}));

describe('/api/notion/archived-tasks.get.ts', () => {
  beforeEach(() => {
    // Vitest 4 restoreAllMocks no longer resets vi.fn() implementations
    vi.mocked(isNotionStubEnabled).mockReturnValue(false)
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('should return empty array when no archive status is configured', async () => {
    const mockResults = [{ id: 'a' }, { id: 'b' }]
    const requestSpy = vi.fn().mockResolvedValue({ results: mockResults })
    await vi.resetModules()
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/archived-tasks.get')).default
    const app = createApp()
    app.use(handler)
    
    const response = await supertest(toNodeListener(app))
      .get('/')
      .query({
        token: 'test-token',
        databaseId: 'test-db',
        dataSourceId: 'test-ds',
        propertyMapping: JSON.stringify({
          title: 'Title',
          status: 'Status',
          priority: null,
        }),
        statusMapping: JSON.stringify({
          today: 'Today',
          doing: 'Doing',
          done: 'Done',
          waiting: null,
          archive: null, // No archive status
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('should return empty array when stub mode is enabled', async () => {
    vi.mocked(isNotionStubEnabled).mockReturnValue(true);

    const handler = (await import('~/server/api/notion/archived-tasks.get')).default
    const app = createApp()
    app.use(handler)
    
    const response = await supertest(toNodeListener(app))
      .get('/')
      .query({
        token: 'test-token',
        databaseId: 'test-db',
        dataSourceId: 'test-ds',
        propertyMapping: JSON.stringify({
          title: 'Title',
          status: 'Status',
          priority: null,
        }),
        statusMapping: JSON.stringify({
          today: 'Today',
          doing: 'Doing',
          done: 'Done',
          waiting: null,
          archive: 'Archived',
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(isNotionStubEnabled).toHaveBeenCalled();
  });

  it('should fetch archived tasks when archive status is configured', async () => {
    const mockNotionResponse = {
      results: [
        {
          id: 'archived-page-1',
          properties: {
            Status: { select: { name: 'Archived' } },
            Title: { title: [{ plain_text: 'Archived Task 1' }] },
            'Time Box': { number: 3600 },
            'Time Spent': { number: 1800 },
            Topic: { select: { name: 'Work' } },
            'Topic Color': { select: { name: 'Blue' } },
            Activity: { select: { name: 'Development' } },
            'Is Unplanned': { checkbox: false },
            Completed: { date: { start: '2023-10-30T10:00:00Z' } },
          },
        },
        {
          id: 'archived-page-2',
          properties: {
            Status: { select: { name: 'Archived' } },
            Title: { title: [{ plain_text: 'Archived Task 2' }] },
            'Time Box': { number: 7200 },
            'Time Spent': { number: 5400 },
            Topic: { select: null },
            'Topic Color': { select: null },
            Activity: { select: null },
            'Is Unplanned': { checkbox: true },
            Completed: { date: { start: '2023-10-29T15:00:00Z' } },
          },
        },
      ],
    };

    const requestSpy = vi.fn().mockResolvedValue(mockNotionResponse);
    await vi.resetModules();
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }));

    const handler = (await import('~/server/api/notion/archived-tasks.get')).default;
    const app = createApp()
    app.use(handler)
    
    const response = await supertest(toNodeListener(app))
      .get('/')
      .query({
        token: 'test-token',
        databaseId: 'test-db',
        dataSourceId: 'test-ds',
        propertyMapping: JSON.stringify({
          title: 'Title',
          status: 'Status',
          priority: null,
          timeBox: 'Time Box',
          timeSpent: 'Time Spent',
          topic: 'Topic',
          topicColor: 'Topic Color',
          activity: 'Activity',
          isUnplanned: 'Is Unplanned',
          completed: 'Completed',
        }),
        statusMapping: JSON.stringify({
          today: 'Today',
          doing: 'Doing',
          done: 'Done',
          waiting: null,
          archive: 'Archived',
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({
      id: 'archived-page-1',
      title: 'Archived Task 1',
      status: 'Done',
      timeBoxSeconds: 3600,
      timeSpentSeconds: 1800,
      topic: 'Work',
      isUnplanned: false,
      completedAt: '2023-10-30T10:00:00.000Z',
    });
  });

  it('should validate required query parameters', async () => {
    const handler = (await import('~/server/api/notion/archived-tasks.get')).default;
    const app = createApp()
    app.use(handler)
    
    const response = await supertest(toNodeListener(app))
      .get('/')
      .query({
        token: 'test-token',
        // missing databaseId, dataSourceId, propertyMapping, statusMapping
      });

    expect(response.status).toBe(400);
    expect(response.body?.data?.error).toBe('MISSING_PARAMETERS');
  });
});
