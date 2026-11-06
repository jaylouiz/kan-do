import { Client } from '@notionhq/client'
import { defineEventHandler, readBody } from 'h3'
import type { UpdatePageParameters } from '@notionhq/client/build/src/api-endpoints'
import { handleNotionError, getTokenFromEvent } from '~/server/utils/apiError'
import { assertStubStatusShape, isNotionStubEnabled, updateStubPage } from '~/server/utils/notionStub'

interface UpdateTaskRequest {
  pageId: string;
  properties: UpdatePageParameters["properties"];
  /**
   * Property names that should merge multi_select values instead of replacing them.
   * For these properties, we fetch current values and append new ones.
   */
  mergeMultiSelectProperties?: string[];
}

export default defineEventHandler(async (event) => {
  try {
    const token = getTokenFromEvent(event)
    const body = await readBody<UpdateTaskRequest>(event)
    const { pageId, properties, mergeMultiSelectProperties } = body

    if (!token || !pageId || !properties) {
      throw new Error('Missing required parameters: token (Authorization header), pageId, and properties are required')
    }

    if (isNotionStubEnabled(token ?? undefined)) {
      assertStubStatusShape(token ?? undefined, { properties: properties as Record<string, unknown> })
      updateStubPage(token ?? undefined, pageId, properties as Record<string, unknown>)
      return { success: true, pageId, properties }
    }

    const notion = new Client({ auth: token!, notionVersion: '2025-09-03' })
    
    // If we need to merge multi_select properties, fetch current page first
    let mergedProperties = properties;
    if (mergeMultiSelectProperties && mergeMultiSelectProperties.length > 0) {
      const currentPage = await notion.pages.retrieve({ page_id: pageId });
      
      // Merge multi_select properties
      mergedProperties = { ...properties };
      for (const propName of mergeMultiSelectProperties) {
        const newValue = properties[propName];
        const currentValue = (currentPage as { properties?: Record<string, unknown> }).properties?.[propName];

        // Only merge if both exist and are multi_select
        if (newValue && currentValue && (currentValue as { type: string }).type === 'multi_select' && (newValue as { multi_select: unknown[] }).multi_select) {
          type SelectOption = { id?: string; name?: string; color?: string; description?: string | null }
          const currentOptions = (currentValue as { multi_select: SelectOption[] }).multi_select || [];
          const newOptions = (newValue as { multi_select: SelectOption[] }).multi_select || [];

          // Merge: keep existing + add new (deduplicate by name)
          const allOptions = [...currentOptions];
          for (const newOpt of newOptions) {
            if (!allOptions.some(existing => existing.name === newOpt.name)) {
              allOptions.push(newOpt);
            }
          }

          mergedProperties[propName] = { multi_select: allOptions as never[] };
        }
      }
    }
    
    await notion.pages.update({
      page_id: pageId,
      properties: mergedProperties,
    })

    return { success: true }
  } catch (error) {
    handleNotionError(error)
  }
});
