// rule: no-unowned-async-error-clear
// verdict: pass
// weakness: alias-guard
// source: invented request projection precision regression

import { useLayoutEffect, useMemo, useRef, useState } from "react";

export const RequestStatus = ({ payload, send }) => {
  const [failure, setFailure] = useState(null);
  const ticket = payload.requestId;
  const latest = useRef(ticket);
  useLayoutEffect(() => {
    latest.current = ticket;
  }, [ticket]);
  const lease = useMemo(() => ({ current: true, requestId: ticket }), [ticket]);
  useLayoutEffect(
    () => () => {
      lease.current = false;
    },
    [lease],
  );
  const submit = async () => {
    const result = await send({ requestId: ticket });
    if (latest.current !== ticket) return;
    switch (latest.current) {
      case ticket:
        break;
      default:
        return;
    }
    while (latest.current !== ticket) {
      return;
    }
    for (; latest.current !== ticket; ) {
      return;
    }
    let shouldCheckOwnership = true;
    do {
      shouldCheckOwnership = false;
      if (latest.current !== ticket) return;
    } while (shouldCheckOwnership);
    try {
      if (latest.current !== ticket) return;
    } finally {
    }
    if (result.ok) setFailure(null);
    else setFailure({ requestId: ticket, result });
  };
  const submitWithSnapshot = async () => {
    const result = await send({ requestId: ticket });
    const stillCurrent = latest.current === ticket;
    if (!stillCurrent) return;
    if (result.ok) setFailure(null);
    else setFailure({ requestId: ticket, result });
  };
  const submitWithLease = async () => {
    const result = await send({ requestId: ticket });
    if (!lease.current) return;
    if (result.ok) setFailure(null);
    else setFailure({ requestId: ticket, result });
  };
  return (
    <div>
      <button onClick={submit}>{failure ? "Retry" : "Send"}</button>
      <button onClick={submitWithSnapshot}>Send with snapshot</button>
      <button onClick={submitWithLease}>Send with lease</button>
    </div>
  );
};
