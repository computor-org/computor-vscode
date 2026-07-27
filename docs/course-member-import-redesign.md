# Course Member Import Redesign - Implementation Plan

## Overview

Redesign the course member import functionality to provide lecturers with granular control over importing course members from XML files. The new implementation adds a preview-based import workflow alongside the existing bulk import.

## Current vs. New Implementation

### Current Workflow (Bulk Import)
1. Select XML file
2. Configure import options (role, update settings, group creation)
3. Upload file → immediate processing
4. View summary results

### New Workflow (Preview Import)
1. Select XML file
2. Parse and display data in interactive table webview
3. **Validate data against database** (shows: Missing/Existing/Modified status)
4. Select rows to import with checkboxes
5. Adjust course role per row via dropdown
6. Filter by status (All/Missing/Existing/Modified)
7. Import selected rows **individually** (one API call per member)
8. Real-time progress updates in table

## Key Features

### 1. Interactive Table Webview
- Display all parsed member data in sortable table
- Status indicators for each member:
  - **Missing**: Email doesn't exist in course (new member)
  - **Existing**: Email exists, data matches database
  - **Modified**: Email exists, but data differs from database
- Show differences for modified members
- Row selection with checkboxes
- Filter buttons: All / Missing / Existing / Modified
- Select/Deselect all functionality

### 2. Course Role Management
- **Dropdown select for each row** to choose course role
- Fetch available roles from `GET /course-roles`
- **Default role logic:**
  - Missing users: `"_student"`
  - Existing users: Current role from database
- Bulk role change options (set all selected to same role)

### 3. Selective Import
- Import only selected rows
- Individual API calls (not bulk)
- Real-time status updates during import
- Retry failed imports without re-uploading file

## API Endpoints

### Existing (Available Now)
```
GET /course-roles
  Returns: CourseRoleList[]
  Purpose: Populate role dropdowns
```

### New Endpoints Needed (Backend Implementation Required)

#### 1. Validate Import Data
```
POST /course-member-import/validate/{course_id}

Request:
{
  "course_id": "string",
  "members": CourseMemberImportRow[]
}

Response:
{
  "validated_members": [
    {
      "row_number": number,
      "email": "string",
      "status": "missing" | "existing" | "modified",
      "existing_member": CourseMemberGet | null,
      "differences": [
        {
          "field": "string",
          "current_value": any,
          "new_value": any
        }
      ],
      "validation_errors": ["string"],
      "suggested_role_id": "string"  // "_student" for new, current role for existing
    }
  ],
  "available_roles": CourseRoleList[]
}
```

**Backend Logic:**
- For each member, check if email exists in course
- Compare data if exists (detect modified fields)
- Return status: "missing", "existing", or "modified"
- Suggest role: "_student" for new users, current role for existing
- Include validation errors (invalid email, missing required fields, etc.)

#### 2. Import Single Member
```
POST /course-member-import/import-single/{course_id}

Request:
{
  "member_data": CourseMemberImportRow,
  "course_role_id": "string",
  "options": {
    "create_missing_groups": boolean,
    "update_if_exists": boolean
  }
}

Response:
{
  "status": "success" | "error" | "updated",
  "course_member": CourseMemberGet,
  "user_id": "string",
  "message": "string",
  "warnings": ["string"]
}
```

**Backend Logic:**
- Create user if doesn't exist (based on email)
- Create or update course member with specified role
- Handle group assignment (create if needed)
- Return detailed result with warnings

## Data Types

### CourseMemberImportRow
```typescript
{
  email: string;                    // Required, identifier
  given_name?: string;              // First name
  family_name?: string;             // Last name
  student_id?: string;              // Matrikelnummer
  course_group_title?: string;      // Group name
  course_role_id?: string;          // Role ID (overridden by dropdown)
  incoming?: string;
  study_id?: string;                // Kennzahl
  study_name?: string;              // Studium
  semester?: number;
  registration_date?: string;
  notes?: string;
}
```

### Import Status
```typescript
type ImportStatus = "missing" | "existing" | "modified";
```

## Implementation Components

### 1. New Command
```
Command: computor.lecturer.importCourseMembersPreview
Location: Context menu on "Groups" folder in lecturer tree
Icon: $(preview)
```

### 2. New Files to Create

#### Webview Provider
- **File**: `src/ui/webviews/CourseMemberImportWebviewProvider.ts`
- **Extends**: `BaseWebviewProvider`
- **Responsibilities**:
  - Display import preview table
  - Handle validation API call
  - Manage row selection and filtering
  - Execute individual member imports
  - Update UI with real-time progress

#### Webview UI Files
- **CSS**: `webview-ui/courses/course-member-import.css`
- **JS**: `webview-ui/courses/course-member-import.js`

(Markup is generated by `CourseMemberImportWebviewProvider` via `renderWebviewPage`;
there are no `.html` files in `webview-ui/`.)

#### API Service Methods
Add to `src/services/ComputorApiService.ts`:
```typescript
async getCourseRoles(): Promise<CourseRoleList[]>
async validateCourseMemberImport(courseId: string, members: CourseMemberImportRow[]): Promise<ValidationResponse>
async importSingleCourseMember(courseId: string, memberData: CourseMemberImportRow, roleId: string, options: ImportOptions): Promise<ImportResult>
```

### 3. Webview Message Handlers

**From Extension to Webview:**
- `validationComplete` - Send validation results
- `importProgress` - Update row import status
- `importComplete` - All imports finished
- `updateBulkRole` - Update multiple rows to same role

**From Webview to Extension:**
- `validate` - Trigger validation
- `importSelected` - Start import for selected rows
- `roleChanged` - Role dropdown changed (optional validation)
- `bulkRoleChange` - Set all selected to same role
- `filterChanged` - Filter changed (All/Missing/Existing/Modified)

## UI Layout

### Table Structure
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Course Member Import Preview                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ Filters: [All] [Missing (15)] [Existing (5)] [Modified (3)]                │
│ Actions: [Select All] [Deselect All] [Import Selected (18)]                │
│ Options: ☑ Create missing groups  ☑ Update existing users                  │
├───┬────────┬───────────────┬────────────┬─────────────┬──────────┬─────────┤
│ ☑ │ Status │ Email         │ Given Name │ Family Name │ Group    │ Role ▼  │
├───┼────────┼───────────────┼────────────┼─────────────┼──────────┼─────────┤
│ ☑ │ 🆕 New │ john@test.com │ John       │ Doe         │ Group A  │ Student │
│ ☐ │ ✓ Exists│ jane@test.com│ Jane       │ Smith       │ Group B  │ Tutor   │
│ ☑ │ ⚠ Diff │ bob@test.com  │ Bob        │ Johnson     │ Group A  │ Student │
└───┴────────┴───────────────┴────────────┴─────────────┴──────────┴─────────┘
```

### Status Indicators
- **🆕 Missing**: Green badge - New member to import
- **✓ Existing**: Blue badge - Already imported, no changes
- **⚠ Modified**: Orange badge - Exists but data differs

### Role Dropdown
- Select element with all available course roles
- Default: "_student" for new, current role for existing
- Disabled when row is unchecked

## Implementation Flow

```
1. User right-clicks "Groups" folder → "Import Members (Preview)"
   ↓
2. File dialog → Select XML file
   ↓
3. Parse XML file → CourseMemberImportRow[]
   ↓
4. Open webview with loading state
   ↓
5. Fetch in parallel:
   - GET /course-roles (available roles)
   - GET /course-members?course_id=... (existing members)
   ↓
6. Client-side diff:
   - Match import data with existing members by email
   - Determine status: missing/existing/modified
   - Set default roles
   ↓
7. Display table with:
   - All parsed member data
   - Real status indicators (missing/existing/modified)
   - Role dropdowns (populated with course roles)
   - Checkboxes (auto-select "missing" members)
   - Filters
   ↓
8. User interaction:
   - Filter by status
   - Select/deselect rows
   - Change roles via dropdown
   - Bulk role changes
   ↓
9. User clicks "Import Selected"
   ↓
10. [PENDING] For each selected row:
    → POST /course-member-import/import-single/{course_id}
    ← Update table row with result (success/error)
    ↓
11. Show completion summary
```

## Phased Implementation

### Phase 1: Basic Webview (Current Implementation)
- ✅ Add new command to groups context menu
- ✅ File selection dialog
- ✅ Parse XML file
- ✅ Create webview with table display
- ✅ Fetch course roles from existing API
- ✅ Display role dropdowns
- ✅ Basic filtering and selection UI
- ⚠️ Mock validation data (no API call yet)

### Phase 2: Backend Integration (After API Ready)
- ⬜ Implement validation API call
- ⬜ Display real status (Missing/Existing/Modified)
- ⬜ Show differences for modified members
- ⬜ Implement individual import API calls
- ⬜ Real-time progress updates

### Phase 3: Polish & Features
- ⬜ Export import results
- ⬜ Retry failed imports
- ⬜ Pagination for large files
- ⬜ Sort by column
- ⬜ Advanced filtering
- ⬜ Bulk actions panel

## Backend Requirements Summary

For the backend team to implement:

**Single Import Endpoint**: `POST /course-member-import/import-single/{course_id}`
- Import one member at a time
- Handle user creation, course member creation/update
- Return detailed result with warnings

**Note**: No validation endpoint needed! The extension uses existing `GET /course-members?course_id=...` endpoint to fetch all members and does client-side diff to determine which are new/existing/modified.

## Naming Conventions

Following project guidelines from `CLAUDE.md`:

- **Classes**: `CourseMemberImportWebviewProvider` (PascalCase)
- **Files**: `course-member-import-webview-provider.ts` (kebab-case)
- **Variables**: `selectedRows`, `validationResults`, `importProgress` (camelCase)
- **Constants**: `IMPORT_STATUS_MISSING`, `FILTER_TYPE_ALL` (SCREAMING_SNAKE_CASE)
- **Types**: `ImportFilterType`, `ValidationResult` (PascalCase)

## Notes

- Existing bulk import (`computor.lecturer.importCourseMembers`) remains unchanged
- Both workflows available: bulk for simple cases, preview for careful control
- XML parsing can be done client-side or server-side (TBD based on security requirements)
- Consider rate limiting for individual API calls (e.g., 10 concurrent max)
