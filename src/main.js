import * as State from './state/index.js';
import * as SRS from './srs/index.js';
import * as Quiz from './quiz/index.js';
import * as Simulator from './simulator/index.js';
import * as Labs from './labs/index.js';
import * as Dashboard from './dashboard/index.js';

export function bootstrap() {
  State.init?.();
  SRS.init?.();
  Quiz.init?.();
  Simulator.init?.();
  Labs.init?.();
  Dashboard.init?.();
}
bootstrap();
