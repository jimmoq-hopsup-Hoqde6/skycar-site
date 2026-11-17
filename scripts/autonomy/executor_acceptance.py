"""Trusted assertions. Never import candidate code into this controller process."""
import hashlib
import json
import uuid
from bounded_coding_pilot import PilotError

ACTIONS = ('quote', 'decline', 'start', 'complete')
CASES = tuple(action + ':' + mode for action in ACTIONS for mode in ('same', 'different'))


def challenges():
    result = []
    for name in CASES:
        action, mode = name.split(':')
        job, account, other, key = (str(uuid.uuid4()) for _ in range(4))
        payload = ({'scope_summary': 'Inspect the synthetic bumper scratch.', 'total_price_cents': 100,
                    'expires_at': '2030-01-01T00:00:00Z', 'starts_at': '2030-01-02T00:00:00Z',
                    'ends_at': '2030-01-02T01:00:00Z'} if action == 'quote' else {})
        result.append({'case': name, 'nonce': uuid.uuid4().hex, 'job': job, 'key': key,
                       'expected_account': account, 'returned_account': account if mode == 'same' else other,
                       'command': {'action': action, 'payload': payload},
                       'result': {'id': job, 'action': action,
                                  'state': {'quote': 'quotes_ready', 'decline': 'review',
                                            'start': 'in_progress', 'complete': 'completed'}[action],
                                  'quote_id': other if action == 'quote' else None, 'replayed': False}})
    return result


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def verify_responses(expected, observed):
    """Candidate responses are data, never TAP, an exit status or a claimed test result."""
    if (type(observed) is not dict or set(observed) != {'version', 'responses'}
            or type(observed['version']) is not int or observed['version'] != 1
            or type(observed['responses']) is not list or len(observed['responses']) != len(CASES)
            or tuple(x['case'] for x in expected) != CASES):
        raise PilotError('Missing independent acceptance responses')
    for challenge, response in zip(expected, observed['responses']):
        if (type(response) is not dict
                or set(response) != {'case', 'nonce', 'calls', 'status', 'headers', 'body'}
                or response['case'] != challenge['case'] or response['nonce'] != challenge['nonce']):
            raise PilotError('Independent acceptance response identity mismatch')
        calls = [{'job': challenge['job'], 'key': challenge['key'],
                  'command': challenge['command'], 'expected': challenge['expected_account']}]
        same = challenge['expected_account'] == challenge['returned_account']
        headers, body = response['headers'], response['body']
        if (canonical(response['calls']) != canonical(calls)
                or type(response['status']) is not int or response['status'] != (200 if same else 403)
                or type(headers) is not dict or set(headers) != {'cache', 'vary', 'account'}
                or headers['cache'] != 'private, no-store' or headers['vary'] != 'Cookie'
                or type(body) is not dict):
            raise PilotError('Independent technician acceptance failed')
        if same:
            if (headers['account'] != challenge['expected_account']
                    or canonical(body.get('data')) != canonical(challenge['result'])):
                raise PilotError('Same-account response changed')
        elif ('data' in body or type(body.get('error')) is not dict
              or body['error'].get('code') != 'FORBIDDEN' or headers['account'] is not None):
            raise PilotError('Foreign account response was not denied privately')
    return {'cases_passed': list(CASES),
            'responses_sha256': hashlib.sha256(canonical(observed).encode()).hexdigest()}
