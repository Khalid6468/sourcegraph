import '../../config/polyfill'

import * as H from 'history'
import React from 'react'
import { Observable } from 'rxjs'
import { startWith } from 'rxjs/operators'
import { setLinkComponent } from '../../../../../shared/src/components/Link'
import { getURL } from '../../browser/extension'
import storage from '../../browser/storage'
import { StorageItems } from '../../browser/types'
import { checkIsBitbucket } from '../../libs/bitbucket/code_intelligence'
import { injectCodeIntelligence } from '../../libs/code_intelligence'
import { checkIsGitHub, checkIsGitHubEnterprise } from '../../libs/github/code_intelligence'
import { checkIsGitlab } from '../../libs/gitlab/code_intelligence'
import { checkIsPhabricator } from '../../libs/phabricator/code_intelligence'
import { initSentry } from '../../libs/sentry'
import { injectSourcegraphApp } from '../../libs/sourcegraph/inject'
import { setSourcegraphUrl } from '../../shared/util/context'
import { MutationRecordLike, observeMutations } from '../../shared/util/dom'
import { featureFlags } from '../../shared/util/featureFlags'
import { assertEnv } from '../envAssertion'

assertEnv('CONTENT')

initSentry('content')

setLinkComponent(({ to, children, ...props }) => (
    <a href={to && typeof to !== 'string' ? H.createPath(to) : to} {...props}>
        {children}
    </a>
))

/**
 * Main entry point into browser extension.
 */
function observe(): void {
    console.log('Sourcegraph browser extension is running')

    const mutations: Observable<MutationRecordLike[]> = observeMutations(document.body, {
        childList: true,
        subtree: true,
    }).pipe(startWith([{ addedNodes: [document.body], removedNodes: [] }]))

    const extensionMarker = document.createElement('div')
    extensionMarker.id = 'sourcegraph-app-background'
    extensionMarker.style.display = 'none'
    if (document.getElementById(extensionMarker.id)) {
        return
    }

    const handleGetStorage = async (items: StorageItems) => {
        if (items.disableExtension) {
            return
        }

        const srcgEl = document.getElementById('sourcegraph-chrome-webstore-item')
        const sourcegraphServerUrl = items.sourcegraphURL || 'https://sourcegraph.com'
        const isSourcegraphServer = window.location.origin === sourcegraphServerUrl || !!srcgEl

        const isPhabricator = await checkIsPhabricator()
        const isGitHub = checkIsGitHub()
        const isGitHubEnterprise = checkIsGitHubEnterprise()
        const isBitbucket = checkIsBitbucket()
        const isGitlab = checkIsGitlab()

        if (!isSourcegraphServer && !document.getElementById('ext-style-sheet')) {
            if (isPhabricator || isGitHub || isGitHubEnterprise || isBitbucket || isGitlab) {
                const styleSheet = document.createElement('link')
                styleSheet.id = 'ext-style-sheet'
                styleSheet.rel = 'stylesheet'
                styleSheet.type = 'text/css'
                styleSheet.href = getURL('css/style.bundle.css')
                document.head.appendChild(styleSheet)
            }
        }

        injectSourcegraphApp(extensionMarker)
        setSourcegraphUrl(sourcegraphServerUrl)

        if (isGitHub || isGitHubEnterprise || isPhabricator || isGitlab || isBitbucket) {
            const subscriptions = await injectCodeIntelligence(mutations)
            window.addEventListener('unload', () => subscriptions.unsubscribe())
        }
    }

    storage.getSync(handleGetStorage)

    document.addEventListener('sourcegraph:storage-init', () => {
        storage.getSync(handleGetStorage)
    })
    // Allow users to set this via the console.
    ;(window as any).sourcegraphFeatureFlags = featureFlags
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // document is already ready to go
    observe()
} else {
    document.addEventListener('DOMContentLoaded', observe)
}
