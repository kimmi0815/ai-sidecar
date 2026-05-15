type ChromeEvent<T extends (...args: any[]) => any> = {
  addListener(callback: T): void;
  removeListener(callback: T): void;
  hasListener(callback: T): boolean;
};

declare namespace chrome {
  namespace runtime {
    type MessageSender = {
      tab?: tabs.Tab;
    };

    const onInstalled: ChromeEvent<() => void>;
    const onStartup: ChromeEvent<() => void>;
    const onMessage: ChromeEvent<(message: any, sender: MessageSender, sendResponse: (response?: any) => void) => boolean | void>;

    function sendMessage(message: any): Promise<any>;
    function getURL(path: string): string;
    function openOptionsPage(): void;
    function getContexts(options: { contextTypes: string[]; documentUrls: string[] }): Promise<Array<Record<string, unknown>>>;
  }

  namespace action {
    function setBadgeText(details: { text: string }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  }

  namespace commands {
    const onCommand: ChromeEvent<(command: string) => void>;
  }

  namespace contextMenus {
    type ContextType = "all" | "selection";

    type OnClickData = {
      menuItemId: string | number;
      selectionText?: string;
    };

    type CreateProperties = {
      id: string;
      title: string;
      contexts: ContextType[];
    };

    const onClicked: ChromeEvent<(info: OnClickData, tab?: tabs.Tab) => void>;
    function create(properties: CreateProperties): void;
    function removeAll(): Promise<void>;
  }

  namespace declarativeNetRequest {
    function updateEnabledRulesets(options: { enableRulesetIds?: string[]; disableRulesetIds?: string[] }): Promise<void>;
  }

  namespace offscreen {
    function createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void>;
  }

  namespace scripting {
    function executeScript<T = unknown>(options: {
      target: { tabId: number };
      func: (...args: any[]) => T | Promise<T>;
      args?: any[];
    }): Promise<Array<{ result?: T }>>;
  }

  namespace sidePanel {
    function setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
    function open(options: { windowId?: number; tabId?: number }): Promise<void>;
  }

  namespace storage {
    type StorageAreaName = "local" | "sync" | "managed" | "session";

    type StorageChange = {
      oldValue?: any;
      newValue?: any;
    };

    const onChanged: ChromeEvent<(changes: Record<string, StorageChange>, areaName: StorageAreaName) => void>;

    namespace local {
      function get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, any>>;
      function set(items: Record<string, unknown>): Promise<void>;
      function remove(keys: string | string[]): Promise<void>;
    }
  }

  namespace tabs {
    type Tab = {
      id?: number;
      windowId?: number;
      title?: string;
      url?: string;
    };

    function query(queryInfo: { active?: boolean; currentWindow?: boolean; lastFocusedWindow?: boolean }): Promise<Tab[]>;
    function create(createProperties: { url: string; active?: boolean; windowId?: number }): Promise<Tab>;
    function update(tabId: number, updateProperties: { url?: string; active?: boolean }): Promise<Tab>;
  }

  namespace windows {
    type Window = {
      id?: number;
      tabs?: tabs.Tab[];
      left?: number;
      top?: number;
      width?: number;
      height?: number;
      type?: string;
    };

    type UpdateInfo = {
      left?: number;
      top?: number;
      width?: number;
      height?: number;
      focused?: boolean;
    };

    type CreateData = UpdateInfo & {
      url?: string | string[];
      type?: "normal" | "popup" | "panel";
    };

    const onRemoved: ChromeEvent<(windowId: number) => void>;
    function get(windowId: number, getInfo?: { populate?: boolean }): Promise<Window>;
    function getLastFocused(getInfo?: { populate?: boolean }): Promise<Window>;
    function create(createData: CreateData): Promise<Window>;
    function update(windowId: number, updateInfo: UpdateInfo): Promise<Window>;
  }
}
