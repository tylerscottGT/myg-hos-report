# Driver HOS Report

A MyGeotab add-in that summarizes duty-status time for HOS-enabled drivers. It provides a daily summary, interval-level status detail, MyGeotab group and driver filters, and an Excel export.

The report is intended for operational review. It does **not** create, edit, certify, or replace MyGeotab's official duty-status logs or required compliance records.

## What it does

- Reports drivers that are marked as drivers and have an HOS ruleset configured (the Drive App/availability-calculation population).
- Offers **This Week**, **Last Week**, **This Month**, **Last Month**, and **Custom Range** date selections.
- Shows a **Daily Summary** with time in Off Duty, Sleeper Berth, Driving, On Duty Not Driving, Yard Move, Personal Conveyance, and Total Tracked.
- Includes those six duty-status categories; certification, login/logout, and other control/system events are not separate summary categories.
- Shows **Status Detail** intervals between duty-status changes. Dates in this view identify the interval's start date; an interval can cross midnight.
- Follows the signed-in user's current MyGeotab group filter, including descendants and supported advanced AND/OR group conditions. A separate searchable driver selector can narrow the results further.
- Links summary dates to the driver's MyGeotab HOS logs for that date.
- Downloads the current report as an `.xlsx` workbook with **Summary** and **Status Detail** sheets. The export reflects the current group and driver filters.

## Typical use cases

- Review daily HOS time for a driver or fleet over a selected period.
- Compare status time across drivers in a selected MyGeotab group.
- Drill from a daily summary into the driver's native MyGeotab HOS logs.
- Share a filtered summary and interval detail in Excel.

Use MyGeotab's native HOS logs and applicable compliance workflows when validating or acting on an individual log. This report is a convenience summary, not a legal determination or audit record.

## Date and duration behavior

- Date boundaries use the browser's local timezone.
- **This Week** starts Monday at local midnight and runs through the current time. **Last Week** covers the previous Monday through Sunday.
- **This Month** runs from the first day of the current month through the current time. **Last Month** covers the previous calendar month.
- Custom start and end dates are inclusive; calculations end at midnight after the selected end date.
- The daily summary splits intervals at local midnight. Status Detail lists intervals between status changes and may show an end time on the following date.
- A status interval runs until the next valid status log, the end of the requested period, or the current time for an in-progress period. Total Tracked can be below 24 hours when no status interval covers part of a day.
- Day totals can be 23 or 25 hours around daylight-saving changes. That can reflect the local calendar day rather than a reporting error.

## Important interpretation limits

### Carried and inferred statuses

At the start of a report, the add-in asks MyGeotab for the boundary log immediately before the range and carries its status forward when appropriate. If no valid prior status is available and there is a gap before the first in-range log, the add-in seeds that gap with a **synthetic OFF** status. A HOS-enabled driver with no valid logs in the range is also seeded as OFF so the driver appears in the report.

Synthetic OFF time is an assumption used to fill a gap; it is not proof that the driver actually logged Off Duty. Verify it against the driver's native HOS logs before relying on it. The workbook does not currently mark synthetic intervals differently from logged OFF intervals.

### API and fleet-size limits

- The add-in fetches status logs one day at a time, with a 50,000-result limit per day request. The current implementation does not page through an individual day that reaches that limit; a very high-volume day may therefore be incomplete.
- The boundary-status lookup is limited to 25,000 results and fails with an error if that limit is reached.
- Driver and group-hierarchy reads are each limited to 50,000 results. Incomplete group data fails closed rather than showing unscoped report rows.
- Longer periods and large fleets can take longer to load. If a result-limit warning or error appears, narrow the date range and validate using native MyGeotab reports/logs.

### Group filtering and permissions

The group and driver filters control which report rows and export rows are displayed; they are **not** a security boundary. The add-in uses the signed-in user's MyGeotab API access and does not bypass that user's clearances. Group filtering is applied to the report in the browser after the required data is fetched, so it does not necessarily reduce the API query scope. With a selected group, a driver whose group membership data is incomplete is omitted rather than included speculatively. Assign user clearances and add-in availability through MyGeotab administration, not through this report filter.

## Install in a MyGeotab database

The public manifest is:

```text
https://tylerscottgt.github.io/myg-hos-report/config.json
```

The current manifest points to the v10 page and names its menu item **Driver HOS Weekly Report** under **Compliance**. The report tab itself is named **Daily Summary**.

### Manual installation

1. Sign in to the intended MyGeotab database as an administrator with **Change system settings** and **Administer Add-ins** permissions.
2. Go to **System → Settings → Add-Ins**. If MyGeotab requires **Allow unverified Add-Ins**, only enable it if the database owner and applicable security/admin policy permit it; this is a database-level trust setting.
3. Open the manifest URL above and copy its JSON.
4. Click **+ Add-In**, paste the JSON into the **Configuration** tab, then click **Done** and **Save**.
5. Assign access to the intended users/groups and confirm their MyGeotab clearances allow the required HOS data.
6. Open **Compliance → Driver HOS Weekly Report**, choose a date range, and click **Run Report**.

The manifest currently has `"isSigned": false`. If the database's policy does not permit this unsigned add-in, do not install it through an exception; use an approved/signed distribution path instead.

Install the add-in separately in each database where it is needed. For customer databases, obtain customer/database-owner approval and follow the applicable internal change and security review process before installation.

### CLI alternative

The `cli-mygeotab` tool can install the manifest into a target database:

```bash
cli-mygeotab --profile TARGET_PROFILE addin deploy \
  --url 'https://tylerscottgt.github.io/myg-hos-report/config.json' \
  --group-id APPROVED_GROUP_ID
```

Choose the intended group scope explicitly. The CLI defaults to `GroupCompanyId` (company-wide) if `--group-id` is omitted. The deploy command writes to the selected database and requires interactive confirmation.

## Troubleshooting

- **No HOS drivers appear:** the report includes only users configured as drivers with an HOS ruleset. Confirm the user has the expected MyGeotab driver/HOS configuration and that the signed-in account can read the required data.
- **No rows or a group-scope error:** check the database's current MyGeotab group filter and user clearance. The add-in fails closed if it cannot safely resolve the selected group hierarchy.
- **Excel download is unavailable:** run the report successfully first. If the spreadsheet library failed to load, refresh MyGeotab and try again after network access is restored.
- **The page looks unchanged after a publish:** refresh/reopen the MyGeotab page so the browser loads the latest centrally hosted files.

## Hosting and data handling

- The add-in page, group-filter helper, and shared SheetJS library are served from the public GitHub Pages site; the manifest is `config.json` in this repository.
- In the current v10 code, driver, group, and HOS data are requested through the MyGeotab API object supplied to the add-in. Excel files are generated in the browser. The code does not implement an upload of report rows to a separate analytics or storage service.
- The source is centrally hosted. Publishing a change to the hosted v10 files can affect every installed database after clients load the updated files; a per-database reinstall is generally not required for page-code updates.
- Because the code is unsigned and centrally hosted, database/customer administrators should review and approve this trust boundary before installation.

## Repository layout and maintenance

- `v10/index.html` — current add-in page and report implementation.
- `v10/group-filter.js` — v10 MyGeotab group-filter handling.
- `config.json` — add-in manifest; it currently points to `v10/index.html`.
- `index.html` — legacy v9 page. Keep it isolated from v10 changes unless a change is explicitly intended for v9.
- `xlsx.full.min.js` — shared spreadsheet library used by both versions.
- `tests/` — behavior and deployment-isolation tests.

Run the test suite with:

```bash
node --test tests
```

Iris KB reference for manual installation: **“How to install and/or uninstall an add-in manually into MyGeotab database.”**
