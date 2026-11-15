import { WeekPage } from '@/components/week/week-page';

/**
 * One week (`/plan/detail?week=YYYY-MM-DD`): the one-page planner, opened
 * from the Meal plans home or Home's Up next card.
 */
export default function PlanWeekDetail() {
  return <WeekPage showBack />;
}
