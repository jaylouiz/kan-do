import { Client } from "@notionhq/client";
import { defineEventHandler, createError } from "h3";
import { getStubbedDatabases, isNotionStubEnabled } from "~/server/utils/notionStub";
import { validateRequest } from "~/server/utils/apiError";

// Define a type for Notion database results
interface NotionDatabase {
  id: string;
  title?: Array<{ plain_text?: string }> | string;
}

// Define a type for API errors with status code
interface NotionApiError extends Error {
  status?: number;
}

export default defineEventHandler(async (event) => {
  // Token arrives via `Authorization: Bearer` header (NotionClientAPI proxy mode);
  // validateRequest also accepts the legacy `?token=` query param and throws 400 when missing.
  const query = validateRequest(event, ["token"]);
  const token = query.token as string;
  const id = query.id as string;

  if (isNotionStubEnabled(token)) {
    const databases = getStubbedDatabases<Array<{ id: string; title: string; dataSources?: Array<{ id: string; name: string | null }> }>>();
    if (id) {
      const database = databases.find((db) => db.id === id);
      if (!database) {
        throw createError({ statusCode: 404, message: "Database not found" });
      }
      return database;
    }
    return databases.map((db) => ({ id: db.id, title: db.title }));
  }

  const notion = new Client({ auth: token, notionVersion: '2022-06-28' });

  try {
    // If id is provided, retrieve specific database
    if (id) {
      const response = await notion.databases.retrieve({
        database_id: id,
      });
      return response;
    }

    // Otherwise, list all databases
    const response = await notion.search({
      filter: {
        property: "object",
        value: "database" as "page",
      },
    });

    return response.results.map((db: NotionDatabase) => ({
      id: db.id,
      title: db.title || "Untitled",
    }));
  } catch (error) {
    // Cast to NotionApiError to access status property
    const apiError = error as NotionApiError;
    console.error("Error accessing Notion database:", error);
    throw createError({
      statusCode: apiError.status || 500,
      message: apiError.message || "Failed to access Notion database",
    });
  }
});
