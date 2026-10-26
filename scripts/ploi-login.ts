import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login to Ploi
  await page.goto("https://ploi.io/login");
  await page.waitForSelector('input[name="email"]');
  await page.fill('input[name="email"]', "ronylicha@gmail.com");
  await page.fill('input[name="password"]', "21081986Rl@");
  await page.click('button[type="submit"]');

  // Wait for panel redirect (Ploi uses /panel, not /dashboard)
  await page.waitForURL("**/panel**", { timeout: 30000 });
  console.log("LOGIN_OK");

  // Take screenshot of panel to see actual layout
  await page.screenshot({ path: "/tmp/ploi-panel.png", fullPage: true });
  console.log("PANEL_SCREENSHOT_SAVED");

  // Navigate directly to sites list
  await page.goto("https://ploi.io/panel/sites");
  await page.waitForLoadState("networkidle", { timeout: 15000 });
  await page.screenshot({ path: "/tmp/ploi-sites.png", fullPage: true });
  console.log("SITES_SCREENSHOT_SAVED");

  // Try multiple selectors to find the site
  const selectors = [
    "text=giga-pdf.com",
    'a:has-text("giga-pdf.com")',
    '[href*="giga-pdf"]',
    'td:has-text("giga-pdf.com")',
    '.site-name:has-text("giga-pdf")',
  ];

  let found = false;
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 });
      console.log(`FOUND_WITH_SELECTOR: ${sel}`);
      await page.click(sel);
      found = true;
      break;
    } catch {
      console.log(`NOT_FOUND: ${sel}`);
    }
  }

  if (!found) {
    // Dump page content for debugging
    const bodyText = await page.textContent("body");
    console.log("PAGE_TEXT_START");
    console.log(bodyText?.substring(0, 2000));
    console.log("PAGE_TEXT_END");
    await browser.close();
    process.exit(1);
  }

  await page.waitForURL("**/sites/**", { timeout: 15000 });
  console.log("SITE_PAGE_OK");

  // Look for Deploy tab
  const deployTab = await page.$(
    'a[href*="deploy"], button:has-text("Deploy"), a:has-text("Deploy")'
  );
  if (deployTab) {
    await deployTab.click();
    await page.waitForTimeout(2000);
    console.log("DEPLOY_TAB_OK");
  }

  // Get deploy script content
  const scriptArea = await page.$('textarea, pre, code, .CodeMirror, [class*="editor"]');
  if (scriptArea) {
    const content = await scriptArea.textContent();
    console.log("CURRENT_SCRIPT_START");
    console.log(content?.substring(0, 3000));
    console.log("CURRENT_SCRIPT_END");
  } else {
    console.log("NO_SCRIPT_EDITOR_FOUND");
  }

  await page.screenshot({ path: "/tmp/ploi-dashboard.png", fullPage: true });
  console.log("SCREENSHOT_SAVED");
  console.log(`CURRENT_URL: ${page.url()}`);
  console.log(`PAGE_TITLE: ${await page.title()}`);

  await browser.close();
})();
