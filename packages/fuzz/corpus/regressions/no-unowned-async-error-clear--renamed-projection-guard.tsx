// rule: no-unowned-async-error-clear
// verdict: pass
// weakness: alias-guard
// source: invented request projection precision regression

import { useLayoutEffect, useRef, useState } from "react";

export const RequestStatus = ({ payload, send }) => {
  const [failure, setFailure] = useState(null);
  const ticket = payload.requestId;
  const latest = useRef(ticket);
  useLayoutEffect(() => {
    latest.current = ticket;
  }, [ticket]);
  const submit = async () => {
    const result = await send({ requestId: ticket });
    if (latest.current !== ticket) return;
    if (result.ok) setFailure(null);
    else setFailure({ requestId: ticket, result });
  };
  return <button onClick={submit}>{failure ? "Retry" : "Send"}</button>;
};
