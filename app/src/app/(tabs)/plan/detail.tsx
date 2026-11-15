import { WeekPage } from '@/components/week/week-page';

/**
 * Deep link to one week (`/plan/detail?week=YYYY-MM-DD`), e.g. from Home's
 * upcoming meals. Same page as the tab, with a back button.
 */
export default function PlanWeekDetail() {
  return <WeekPage showBack />;
}
