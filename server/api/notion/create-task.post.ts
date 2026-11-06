import { Client } from "@notionhq/client";
import { defineEventHandler, readBody } from "h3";
import { throwApiError, handleNotionError, getTokenFromEvent } from "~/server/utils/apiError";
import { assertStubStatusShape, createStubPage, isNotionStubEnabled, stubCreateFailureStatus, stubFailureError } from "~/server/utils/notionStub";

/**
 * Creates a new task (page) in a Notion database
 */
export default defineEventHandler(async (event) => {
  try {
    const token = getTokenFromEvent(event);
    const body = await readBody(event);
    const { databaseId, properties } = body;

    if (!token || !databaseId || !properties) {
      throwApiError(
        400,
        "Missing required parameters: token (Authorization header), databaseId, and properties are required",
        { error: "MISSING_PARAMETERS" }
      );
    }

    if (isNotionStubEnabled(token ?? undefined)) {
      const refused = stubCreateFailureStatus(token);
      if (refused !== null) throw stubFailureError(refused);
      assertStubStatusShape(token ?? undefined, { properties });
      const page = createStubPage(token ?? undefined, properties);
      return { success: true, pageId: page.id, page };
    }

    const notion = new Client({ auth: token!, notionVersion: '2022-06-28' });

    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties,
    });

    return {
      success: true,
      pageId: response.id,
      page: response,
    };
  } catch (error: any) {
    console.error("Error creating Notion page:", error);
    
    // Use standard Notion error handler
    handleNotionError(error);
  }
});
