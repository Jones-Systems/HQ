"""Deterministic stand-in for ``social_service.worker`` used only while capturing the golden exchanges.

The exchanges pin the wire contract, so they must not depend on the analyzers. This worker reads the run's
``input.json`` like the real one and answers with a fixed envelope: ``{"fail": true}`` input fails with a fixed
message, anything else succeeds with an echo. It imports nothing from ``social_service``.
"""

import json
import sys
from pathlib import Path


def main():
    run_dir = Path(sys.argv[1])
    payload = json.loads((run_dir / 'input.json').read_text(encoding='utf-8'))
    if payload['input'].get('fail'):
        envelope = {'ok': False, 'error': 'Synthetic contract failure'}
    else:
        envelope = {'ok': True, 'result': {'worker': 'contract', 'tool': payload['tool'], 'echo': payload['input']}}
    (run_dir / 'result.json').write_text(json.dumps(envelope), encoding='utf-8')


if __name__ == '__main__':
    main()
