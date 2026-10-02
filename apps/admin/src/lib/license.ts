import { useEffect, useState } from 'react'
import type { ApiClient } from './api-client'

/**
 * Whether this deployment is licensed to drop the attribution.
 *
 * Fails closed, and that is the whole design: the badge is assumed to belong on
 * screen until a valid licence says otherwise. A request that errors, a network
 * that is down, a server that has not answered yet -- none of them is a licence,
 * and a badge that disappears when the API is unhealthy would make "was this paid
 * for" answerable by unplugging something.
 *
 * Nothing here verifies anything. The signature is checked on the server against
 * a key the browser never sees; this asks what the answer was.
 */

export interface LicenseState {
  whiteLabel: boolean
}

export function useLicense(client: ApiClient): LicenseState {
  const [whiteLabel, setWhiteLabel] = useState(false)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const license = await client.getLicense()
        if (!cancelled) setWhiteLabel(license.whiteLabel)
      } catch {
        // Deliberately silent and deliberately unchanged. The operator sees the
        // badge they expected; a licence problem is reported by the site's log and
        // by the settings screen, not by an error toast on every page.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [client])

  return { whiteLabel }
}
