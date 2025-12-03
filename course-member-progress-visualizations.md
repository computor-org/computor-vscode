# Course Member Progress Visualizations

This document describes the recommended visualizations for displaying student progress data from the `/course-member-gradings` endpoint.

## API Endpoints

### List All Students in a Course
```
GET /course-member-gradings?course_id={uuid}
```

Returns: `CourseMemberGradingsList[]`

### Get Single Student Details
```
GET /course-member-gradings/{course_member_id}
```

Returns: `CourseMemberGradingsGet` (includes hierarchical `nodes[]`)

---

## Response Structure

### CourseMemberGradingsList (per student)

```typescript
interface CourseMemberGradingsList {
  course_member_id: string;
  course_id: string;
  user_id: string | null;
  username: string | null;
  given_name: string | null;
  family_name: string | null;

  total_max_assignments: number;
  total_submitted_assignments: number;
  overall_progress_percentage: number;  // 0-100
  latest_submission_at: string | null;  // ISO datetime

  by_content_type: ContentTypeGradingStats[];
}

interface ContentTypeGradingStats {
  course_content_type_id: string;
  course_content_type_slug: string;      // e.g., "mandatory", "optional"
  course_content_type_title: string | null;
  course_content_type_color: string | null;  // hex color

  max_assignments: number;
  submitted_assignments: number;
  progress_percentage: number;  // 0-100
  latest_submission_at: string | null;
}
```

---

## Per-Course Visualizations

### 1. Progress Distribution Histogram

Shows how students are distributed across progress ranges.

| Property | Value |
|----------|-------|
| **Chart Type** | Histogram / Bar Chart |
| **X-axis** | Progress ranges: 0-10%, 10-20%, ..., 90-100% |
| **Y-axis** | Number of students |
| **Data Source** | `students[].overall_progress_percentage` |

**Data Transformation:**
```typescript
function buildHistogramData(students: CourseMemberGradingsList[]) {
  const buckets = Array(10).fill(0);  // 10 buckets for 0-100%

  students.forEach(s => {
    const bucket = Math.min(Math.floor(s.overall_progress_percentage / 10), 9);
    buckets[bucket]++;
  });

  return buckets.map((count, i) => ({
    range: `${i * 10}-${(i + 1) * 10}%`,
    count
  }));
}
```

**Use Case:** Quickly identify class distribution - are students clustered at high/low ends?

---

### 2. Content Type Comparison Bar Chart

Compares average completion rates across content types (mandatory vs optional).

| Property | Value |
|----------|-------|
| **Chart Type** | Grouped Bar Chart |
| **X-axis** | Content types (from `course_content_type_slug`) |
| **Y-axis** | Average progress percentage |
| **Color** | Use `course_content_type_color` from response |

**Data Transformation:**
```typescript
function buildContentTypeAverages(students: CourseMemberGradingsList[]) {
  const typeMap = new Map<string, { sum: number; count: number; color: string; title: string }>();

  students.forEach(s => {
    s.by_content_type.forEach(ct => {
      const existing = typeMap.get(ct.course_content_type_slug) || {
        sum: 0, count: 0,
        color: ct.course_content_type_color,
        title: ct.course_content_type_title
      };
      existing.sum += ct.progress_percentage;
      existing.count++;
      typeMap.set(ct.course_content_type_slug, existing);
    });
  });

  return Array.from(typeMap.entries()).map(([slug, data]) => ({
    slug,
    title: data.title || slug,
    color: data.color || '#888888',
    averageProgress: data.sum / data.count
  }));
}
```

**Use Case:** See if students prioritize mandatory over optional assignments.

---

### 3. Activity Timeline / Last Submission Scatter

Visualizes when students last submitted work.

| Property | Value |
|----------|-------|
| **Chart Type** | Scatter plot or Timeline |
| **X-axis** | Date (from `latest_submission_at`) |
| **Y-axis** | Students or progress percentage |
| **Color** | Green (recent) → Red (inactive) |

**Data Transformation:**
```typescript
function buildActivityData(students: CourseMemberGradingsList[]) {
  const now = new Date();

  return students
    .filter(s => s.latest_submission_at)
    .map(s => {
      const lastActive = new Date(s.latest_submission_at!);
      const daysSinceActive = Math.floor((now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));

      return {
        name: `${s.given_name} ${s.family_name}`,
        username: s.username,
        lastActive,
        daysSinceActive,
        progress: s.overall_progress_percentage,
        isInactive: daysSinceActive > 14  // threshold
      };
    })
    .sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
}
```

**Use Case:** Identify inactive students who may need outreach.

---

### 4. Student Ranking Table with Progress Bars

A sortable table with inline visualizations.

| Column | Data Source | Visualization |
|--------|-------------|---------------|
| Name | `given_name`, `family_name` | Text |
| Username | `username` | Text |
| Overall Progress | `overall_progress_percentage` | Progress bar |
| Mandatory | `by_content_type[slug="mandatory"].progress_percentage` | Mini progress bar |
| Optional | `by_content_type[slug="optional"].progress_percentage` | Mini progress bar |
| Last Active | `latest_submission_at` | Relative date ("3 days ago") |

**Features:**
- Sortable by any column
- Filterable by progress range
- Click row to navigate to student detail view

---

### 5. Course Summary Cards

Quick statistics at the top of the dashboard.

| Card | Calculation |
|------|-------------|
| **Total Students** | `students.length` |
| **Average Progress** | `avg(students[].overall_progress_percentage)` |
| **Completed (100%)** | `count where overall_progress_percentage === 100` |
| **At Risk (<25%)** | `count where overall_progress_percentage < 25` |
| **Inactive (>14 days)** | `count where daysSince(latest_submission_at) > 14` |

---

## Per-Student Visualizations

*Available from `GET /course-member-gradings/{course_member_id}` which includes `nodes[]`*

### 1. Hierarchical Progress Tree / Sunburst

Shows completion at each level of the course structure.

| Property | Value |
|----------|-------|
| **Chart Type** | Sunburst or Treemap |
| **Hierarchy** | Built from `nodes[].path` (ltree format: "module1.unit1.assignment1") |
| **Color Intensity** | Based on `nodes[].progress_percentage` |
| **Label** | `nodes[].title` |

**Data Transformation:**
```typescript
interface TreeNode {
  name: string;
  path: string;
  progress: number;
  children: TreeNode[];
}

function buildHierarchy(nodes: CourseMemberGradingNode[]): TreeNode {
  const root: TreeNode = { name: 'Course', path: '', progress: 0, children: [] };

  // Sort by path depth
  const sorted = [...nodes].sort((a, b) =>
    a.path.split('.').length - b.path.split('.').length
  );

  sorted.forEach(node => {
    const parts = node.path.split('.');
    let current = root;

    parts.forEach((part, i) => {
      const currentPath = parts.slice(0, i + 1).join('.');
      let child = current.children.find(c => c.path === currentPath);

      if (!child) {
        child = {
          name: node.title || part,
          path: currentPath,
          progress: node.progress_percentage,
          children: []
        };
        current.children.push(child);
      }
      current = child;
    });
  });

  return root;
}
```

**Use Case:** Drill down to see exactly where a student is stuck.

---

### 2. Module Progress Stacked Bars

One bar per top-level module, stacked by content type.

| Property | Value |
|----------|-------|
| **Chart Type** | Horizontal Stacked Bar |
| **Y-axis** | Module names (depth 1 paths) |
| **X-axis** | Submitted / Max assignments |
| **Stacks** | Content types within each module |

**Data Source:** Filter `nodes[]` to depth 1, use `by_content_type[]` for stacks.

---

### 3. Content Type Donut Chart

Simple overview of completion by assignment type.

| Property | Value |
|----------|-------|
| **Chart Type** | Donut / Pie |
| **Segments** | Content types |
| **Value** | `submitted_assignments` |
| **Max** | `max_assignments` |
| **Color** | `course_content_type_color` |

**Data Source:** Root-level `by_content_type[]` array.

---

## Suggested Libraries

| Library | Best For | Notes |
|---------|----------|-------|
| **Recharts** | Bar charts, line charts | React-friendly, declarative |
| **Nivo** | Sunburst, heatmaps | Beautiful defaults, React |
| **Chart.js** | Simple charts | Lightweight, canvas-based |
| **D3.js** | Custom hierarchies | Full control, steeper learning curve |
| **TanStack Table** | Sortable tables | Headless, with inline sparklines |

---

## Example: Full Dashboard Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Course: Introduction to Programming                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Students │ │ Avg Prog │ │ Complete │ │ At Risk  │       │
│  │    45    │ │   67%    │ │    12    │ │    5     │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────┐ ┌─────────────────────────┐   │
│  │  Progress Histogram     │ │  Content Type Averages  │   │
│  │  ▓▓░░░░░▓▓▓▓▓▓▓▓▓▓     │ │  Mandatory: ████░ 80%  │   │
│  │  0%            100%     │ │  Optional:  ██░░░ 45%  │   │
│  └─────────────────────────┘ └─────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  Student Table                                    [Search]  │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Name          │ Progress │ Mandatory │ Optional │ Last│ │
│  ├───────────────┼──────────┼───────────┼──────────┼─────┤ │
│  │ John Doe      │ ████░ 80%│ █████ 100%│ ███░ 60% │ 2d  │ │
│  │ Jane Smith    │ ███░ 65% │ ████░ 80% │ ██░░ 45% │ 5d  │ │
│  │ Bob Wilson    │ █░░░ 20% │ ██░░░ 40% │ ░░░░  0% │ 21d │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Notes

- All percentages are 0-100 (not 0-1)
- Colors for content types come from `course_content_type_color` (hex)
- `latest_submission_at` can be null if no submissions yet
- Hierarchical data (`nodes[]`) only available in single-student endpoint
- Consider caching results client-side (endpoint has 60s server cache)
