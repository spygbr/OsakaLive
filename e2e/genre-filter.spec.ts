/**
 * e2e/genre-filter.spec.ts
 *
 * Smoke tests for the genre filter wiring:
 *   Sidebar button → ?genre=<slug> URL param → /search reads and filters
 *
 * Run:  npx playwright test e2e/genre-filter.spec.ts
 */

import { test, expect } from '@playwright/test'

test.describe('genre filter', () => {
  test('clicking a genre button navigates to /search with correct ?genre= param', async ({ page }) => {
    await page.goto('/search')

    // Pick the first genre button that is NOT the "ALL" reset button.
    // Genre buttons render as e.g. "METAL (13)" or "METAL (0)".
    // They live inside the sidebar's genre grid.
    const genreButtons = page.locator('[data-testid="genre-btn"]')
    const count = await genreButtons.count()

    // If no genre buttons are rendered (all counts are zero and all are hidden),
    // the sidebar toggle "ALL" should reveal them first.
    if (count === 0) {
      const showAllToggle = page.locator('[data-testid="genre-show-all"]')
      if (await showAllToggle.isVisible()) {
        await showAllToggle.click()
      }
    }

    const firstGenreBtn = genreButtons.first()
    await expect(firstGenreBtn).toBeVisible()

    // Read the slug from the button's data attribute before clicking.
    const slug = await firstGenreBtn.getAttribute('data-slug')
    expect(slug).toBeTruthy()

    await firstGenreBtn.click()

    // URL should now contain ?genre=<slug>
    await expect(page).toHaveURL(new RegExp(`[?&]genre=${slug}`))
  })

  test('URL param genre=<slug> is reflected as active button in sidebar', async ({ page }) => {
    await page.goto('/search?genre=metal')

    // The "metal" button should have the active style (bg-primary class or aria-pressed)
    const metalBtn = page.locator('[data-testid="genre-btn"][data-slug="metal"]')
    await expect(metalBtn).toBeVisible()
    // Active genre buttons get bg-primary — check via class or aria
    await expect(metalBtn).toHaveClass(/bg-primary/)
  })

  test('clearing genre filter removes ?genre= param', async ({ page }) => {
    await page.goto('/search?genre=rock')

    // Click the ALL button (no genre selected)
    const allBtn = page.locator('[data-testid="genre-all-btn"]')
    await expect(allBtn).toBeVisible()
    await allBtn.click()

    // URL should no longer contain genre param
    await expect(page).not.toHaveURL(/[?&]genre=/)
  })

  test('genre filter with zero upcoming events shows sparsity hint', async ({ page }) => {
    // Use a genre that is known to have zero coverage.
    // If coverage improves, this test may need updating — that's a good sign.
    await page.goto('/search?genre=noise')

    const hint = page.getByText(/few artists are tagged with this genre yet/i)
    // Only assert the hint is visible if there are genuinely no results.
    const noMatchText = page.getByText(/no events match/i)
    const hasNoMatch = await noMatchText.isVisible()

    if (hasNoMatch) {
      await expect(hint).toBeVisible()
    }
    // If there ARE results now (coverage improved), the hint should be absent.
    else {
      await expect(hint).not.toBeVisible()
    }
  })
})
