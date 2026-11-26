import { createContext, analyzeOptions } from './domain.js';
import {analyzeCurrentPlan} from './planner.js';
import {recommendAdjustments} from './recommendations.js';
self.onmessage = ({ data: request }) => {
  try {
    const ctx = createContext(request.data, request.fixtureId);
    const result = request.recommendationRequest?recommendAdjustments(ctx,request.plan,request.recommendationRequest):request.plan?analyzeCurrentPlan(ctx,request.plan):analyzeOptions(ctx);
    self.postMessage({ requestId: request.requestId, result });
  } catch (error) { self.postMessage({ requestId: request.requestId, error: error.message }); }
};
