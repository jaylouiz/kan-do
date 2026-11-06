import { defineEventHandler } from 'h3';

/**
 * Endpoint to securely access the Notion API key from environment variables
 * @returns The Notion API key if available, or null
 */
export default defineEventHandler(() => {
  // Access the environment variable
  const notionKey = process.env.NOTION_KEY || null;
  
  return {
    hasKey: !!notionKey,
  };
});
