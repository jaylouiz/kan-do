/**
 * @module notionWizard
 * @description Drives the Notion setup wizard (token, database, properties, further properties, status) on the
 * Notion stub, for the specs that end a flow with a real connection (welcome "In Notion", "Verbinden", #324).
 */

import { expect, type Page } from '@playwright/test'
import { notionStubSessionToken } from './seed'

/**
 * Enters a stub token and presses "Weiter" / "Fertig stellen" until the dialog is gone. Every press waits for
 * the step to change first (the token and database steps validate against the stub before they advance), so
 * no step is pressed twice. The stub's defaults need no input beyond the token.
 *
 * "Weiter" on the properties step stays disabled until the schema is auto-mapped (#358), so waiting for the
 * enabled button is enough. The step text is compared as `innerText` (the stepper's `textContent` has no space
 * between number and title, so a `textContent` comparison never differs).
 */
export async function completeNotionWizard(page: Page, token: string = notionStubSessionToken()): Promise<void> {
  const dialog = page.getByRole('dialog')
  const proceed = page.getByTestId('wizard-proceed')
  const currentStep = dialog.locator('[aria-current="step"]')

  await dialog.getByPlaceholder('Integrationstoken eingeben').fill(token)
  for (let press = 0; press < 16; press++) {
    await expect(proceed).toBeEnabled()
    const isLastStep = (await proceed.innerText()).trim() === 'Fertig stellen'
    const before = await currentStep.innerText()
    await proceed.click()
    if (isLastStep) break
    await expect(currentStep).not.toHaveText(before, { useInnerText: true })
  }
  await expect(dialog).toHaveCount(0)
}
