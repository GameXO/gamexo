/**
 * Which Hugeicons glyph stands for a sport.
 *
 * Matched on the sport's slug and name rather than its id, so a sport a venue creates
 * itself ("Squash Court", "Indoor Cricket Nets") still finds a sensible icon, and the
 * stock sports always do. First match wins, so the more specific words come first
 * ("table tennis" before "tennis"). Anything unmatched gets a generic sport glyph —
 * and Dance, which Hugeicons has no figure for, a music note.
 */
import {
  BadmintonIcon,
  BaseballIcon,
  BasketballIcon,
  BicycleIcon,
  BilliardIcon,
  BowlingBallIcon,
  BoxingGloveIcon,
  ChessIcon,
  CricketBatIcon,
  DumbbellIcon,
  FencingMaskIcon,
  FootballIcon,
  GolfBallIcon,
  GymnasticIcon,
  HockeyIcon,
  MusicNote01Icon,
  RollerSkateIcon,
  RunningShoesIcon,
  SwimmingIcon,
  TableTennisBatIcon,
  TennisBallIcon,
  VolleyballIcon,
  WorkoutSportIcon,
  YogaIcon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'

const RULES: [RegExp, IconSvgElement][] = [
  [/table[\s-]?tennis|ping[\s-]?pong|pickle/, TableTennisBatIcon],
  [/badminton|shuttle/, BadmintonIcon],
  [/tennis|squash|racquet|racket/, TennisBallIcon],
  [/cricket/, CricketBatIcon],
  [/football|soccer|futsal/, FootballIcon],
  [/basketball|hoops/, BasketballIcon],
  [/volleyball/, VolleyballIcon],
  [/swim|aqua/, SwimmingIcon],
  [/gym|fitness|weight|crossfit|strength/, DumbbellIcon],
  [/yoga|pilates|meditat/, YogaIcon],
  [/dance|zumba|aerobic/, MusicNote01Icon],
  [/box|mma|martial|karate|judo/, BoxingGloveIcon],
  [/golf/, GolfBallIcon],
  [/billiard|snooker|pool/, BilliardIcon],
  [/bowling/, BowlingBallIcon],
  [/hockey/, HockeyIcon],
  [/baseball|softball/, BaseballIcon],
  [/skat/, RollerSkateIcon],
  [/cycl|bike/, BicycleIcon],
  [/run|athletic|track/, RunningShoesIcon],
  [/gymnast/, GymnasticIcon],
  [/chess/, ChessIcon],
  [/fenc/, FencingMaskIcon],
]

export function sportIconFor(sport: { name: string; slug?: string }): IconSvgElement {
  const text = `${sport.slug ?? ''} ${sport.name}`.toLowerCase()
  return RULES.find(([pattern]) => pattern.test(text))?.[1] ?? WorkoutSportIcon
}
