// Synthetic /api/v1/care/coverage responses for browser tests. No real area data lives here:
// the callback decides each answer, and the default is "available" for every valid body.
export function coverageRoute(decide = () => 'available') {
  const calls = [];
  const handler = async route => {
    const request = route.request();
    const body = JSON.parse(request.postData() || '{}');
    calls.push(body);
    const answer = await decide(body, calls.length);
    if (answer === 'available' || answer === 'unavailable') {
      return route.fulfill({ status: 200, json: { data: { service: body.service, postcode: body.postcode, coverage: answer }, meta: { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } } });
    }
    if (answer === 'abort') return route.abort('failed');
    if (answer === 'down') return route.fulfill({ status: 503, json: { error: { code: 'COVERAGE_UNAVAILABLE', message: 'Coverage cannot be confirmed right now.', fieldErrors: {}, retryable: true }, meta: { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } } });
    return route.fulfill(answer);
  };
  return { calls, handler, pattern: '**/api/v1/care/coverage' };
}
