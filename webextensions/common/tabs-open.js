/* ***** BEGIN LICENSE BLOCK ***** 
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Tree Style Tab.
 *
 * The Initial Developer of the Original Code is YUKI "Piro" Hiroshi.
 * Portions created by the Initial Developer are Copyright (C) 2011-2018
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s): YUKI "Piro" Hiroshi <piro.outsider.reflex@gmail.com>
 *                 wanabe <https://github.com/wanabe>
 *                 Tetsuharu OHZEKI <https://github.com/saneyuki>
 *                 Xidorn Quan <https://github.com/upsuper> (Firefox 40+ support)
 *                 lv7777 (https://github.com/lv7777)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ******/
'use strict';

import {
  log as internalLogger
} from './common.js';
import * as Constants from './constants.js';
import * as ApiTabs from './api-tabs.js';
import * as Tabs from './tabs.js';
import * as TabsContainer from './tabs-container.js';
import * as TabsMove from './tabs-move.js';
import * as Tree from './tree.js';

// eslint-disable-next-line no-unused-vars
function log(...args) {
  internalLogger('common/tabs-open', ...args);
}

export async function loadURI(uRI, options = {}) {
  if (!options.windowId && !options.tab)
    throw new Error('missing loading target window or tab');
  if (options.inRemote) {
    await browser.runtime.sendMessage({
      type:    Constants.kCOMMAND_LOAD_URI,
      uri:     uRI,
      options: Object.assign({}, options, {
        tab: options.tab && options.tab.id
      })
    });
    return;
  }
  try {
    let apiTabId;
    if (options.tab) {
      apiTabId = options.tab.apiTab.id;
    }
    else {
      const apiTabs = await browser.tabs.query({
        windowId: options.windowId,
        active:   true
      });
      apiTabId = apiTabs[0].id;
    }
    await browser.tabs.update(apiTabId, {
      url: uRI
    }).catch(ApiTabs.handleMissingTabError);
  }
  catch(e) {
    ApiTabs.handleMissingTabError(e);
  }
}

export function openNewTab(options = {}) {
  return openURIInTab(null, options);
}

export async function openURIInTab(uri, options = {}) {
  const tabs = await openURIsInTabs([uri], options);
  return tabs[0];
}

export async function openURIsInTabs(uris, options = {}) {
  if (!options.windowId)
    throw new Error('missing loading target window\n' + new Error().stack);

  return await Tabs.doAndGetNewTabs(async () => {
    if (options.inRemote) {
      await browser.runtime.sendMessage(Object.assign({}, options, {
        type:          Constants.kCOMMAND_NEW_TABS,
        uris,
        parent:        options.parent && options.parent.id,
        opener:        options.opener && options.opener.id,
        insertBefore:  options.insertBefore && options.insertBefore.id,
        insertAfter:   options.insertAfter && options.insertAfter.id,
        cookieStoreId: options.cookieStoreId || null,
        isOrphan:      !!options.isOrphan,
        inRemote:      false
      }));
    }
    else {
      await Tabs.waitUntilAllTabsAreCreated();
      const startIndex = Tabs.calculateNewTabIndex(options);
      const container  = Tabs.getTabsContainer(options.windowId);
      TabsContainer.incrementCounter(container, 'toBeOpenedTabsWithPositions', uris.length);
      if (options.isOrphan)
        TabsContainer.incrementCounter(container, 'toBeOpenedOrphanTabs', uris.length);
      await Promise.all(uris.map(async (uRI, index) => {
        const params = {
          windowId: options.windowId,
          active:   index == 0 && !options.inBackground
        };
        if (uRI)
          params.url = uRI;
        if (options.opener)
          params.openerTabId = options.opener.apiTab.id;
        if (startIndex > -1)
          params.index = startIndex + index;
        if (options.cookieStoreId)
          params.cookieStoreId = options.cookieStoreId;
        const apiTab = await browser.tabs.create(params);
        await Tabs.waitUntilTabsAreCreated(apiTab.id);
        const tab = Tabs.getTabById(apiTab);
        if (!tab)
          throw new Error('tab is already closed');
        if (!options.opener &&
            options.parent &&
            !options.isOrphan)
          await Tree.attachTabTo(tab, options.parent, {
            insertBefore: options.insertBefore,
            insertAfter:  options.insertAfter,
            forceExpand:  params.active,
            broadcast:    true
          });
        else if (options.insertBefore)
          await TabsMove.moveTabInternallyBefore(tab, options.insertBefore, {
            broadcast: true
          });
        else if (options.insertAfter)
          await TabsMove.moveTabInternallyAfter(tab, options.insertAfter, {
            broadcast: true
          });
        return tab.opened;
      }));
    }
  });
}

