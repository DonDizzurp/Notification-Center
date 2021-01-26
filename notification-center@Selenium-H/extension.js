
/*
Version 22.01
=============

*/

const ExtensionUtils      = imports.misc.extensionUtils;
const Gio                 = imports.gi.Gio;
const Gtk                 = imports.gi.Gtk;
const LangClass           = imports.lang.Class;
const Main                = imports.ui.main;
const Mainloop            = imports.mainloop;
const MetaKeyBindingFlags = imports.gi.Meta.KeyBindingFlags;
const PanelMenuButton     = imports.ui.panelMenu.Button;
const PopupMenu           = imports.ui.popupMenu;
const ShellActionMode     = imports.gi.Shell.ActionMode;
const St                  = imports.gi.St;
const _                   = imports.gettext.domain("notification-center").gettext;

let notificationCenter = null;

function enable() {

  notificationCenter = new NotificationCenter();
  notificationCenter.startNotificationCenter();
  reloadExtensionOnPrefsChange();
  reloadApplicationProfilesOnPrefsChange();

}

function disable() {

  notificationCenter.undoChanges();
  notificationCenter.destroy();

}

function reloadApplicationProfilesOnPrefsChange() {

  // Reloads Application Profiles when preferences are changed.
  notificationCenter.reloadProfilesSignal = notificationCenter.prefs.connect("changed::reload-profiles-signal", () => notificationCenter.loadPreferences());

}

function reloadExtensionOnPrefsChange() {

  // Reloads the Extension when preferences are changed.
  notificationCenter.reloadSignal = notificationCenter.prefs.connect("changed::reload-signal", () => {
    disable();
    enable();
  });

}

const NotificationCenter = new LangClass({

  Name: "NotificationCenter",
  Extends: PanelMenuButton,

  _init: function () {

    ExtensionUtils.initTranslations("notification-center");
    this.prefs                = ExtensionUtils.getSettings("org.gnome.shell.extensions.notification-center");
    this.reloadSignal         = null;
    this.reloadProfilesSignal = null;
    
    this.dndpref = new Gio.Settings({schema_id:"org.gnome.desktop.notifications"});
    this.parent(1-0.5*this.prefs.get_enum('indicator-pos'), "NotificationCenter");
    this.loadPreferences();

    this.connectedSignals = [];

    this.dmsig  = null;
    this.cmsig  = null;
    this.dndSig = null;
    
    this.isDndOff = true;
    
    this._loopTimeoutId = null;
    
    this.textureCache         = St.TextureCache.get_default();
    this.iconThemeChangeSig   = null;
    this.notificationIconName = null;
    
    this.notificationCount = 0;
    this.eventsCount       = 0;
    this.mediaCount        = 0;
    
    this.eventsIcon  = new St.Icon({icon_name: "x-office-calendar-symbolic",style_class:'system-status-icon',visible:false});
    this.eventsLabel = new St.Label({ text: "• ",visible:false});
    
    this.mediaIcon = new St.Icon({icon_name : "audio-x-generic-symbolic",style_class:'system-status-icon',visible:false});
    
    this.notificationIcon  = new St.Icon({style_class:'system-status-icon',visible:false});
    this.notificationLabel = new St.Label({ text: "• ",visible:false});
    this.notificationIcon.set_pivot_point(0.5, 0);
    
    this._indicator = new St.BoxLayout({ vertical: false, style_class: 'panel-status-menu-box',style:"spacing:0.0em"});
    
    this._messageList        = Main.panel.statusArea.dateMenu._messageList;
    this._messageListParent  = this._messageList.get_parent() ;
    this.messageListRemoved  = false;
    
    this.mediaSection        = this._messageList._mediaSection;
    this.notificationSection = this._messageList._notificationSection;
    this.eventsSection       = Main.panel.statusArea.dateMenu._eventsItem;
    
    this.newEventsSectionParent = this.eventsSection.get_parent();
    
    this.box = new St.BoxLayout({style_class: "notification-center-message-list",vertical: true}); 
    
    this.dndItem     = new PopupMenu.PopupSwitchMenuItem(_("Do Not Disturb"),true,{});
    this.clearButton = new St.Button({style_class: "notification-center-clear-button button", label: _("Clear"),can_focus: true,visible:false});
    
    let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    this.scrollView = new St.ScrollView({hscrollbar_policy:2, style:"min-width:"+(this._messageList.width/scaleFactor)+"px;max-height: "+0.01*this.prefs.get_int("max-height")*Main.layoutManager.monitors[0].height+"px; max-width: "+(this._messageList.width/scaleFactor)+"px; padding: 0px;"})
    
    this.add_style_class_name('notification-center-panel-button');
    
  },

  addClearButton: function( ) {

    if(this.prefs.get_enum("clear-button-alignment")==3){
      return;
    }

    this.clearButton.connect('clicked', ()=> {
      this.notificationSection.clear();
    });
      
    this.clearButton.set_x_align(1+this.prefs.get_enum('clear-button-alignment'));
    this.menu.box.add_child(this.clearButton);

  },
  
  animateOnNewNotification: function( times, op=254, angle=3 ) {

    if(times == 0 || !this.animateIcon) {
      this.animationEnd(200);
      return;
    }
    
    this.visible = true;
    this.notificationIcon.visible = true;
    
    this.notificationIcon.ease({
      duration:         150,
      scale_x:          1.2,
      scale_y:          1.2,
      translation_y:    -4,
      opacity:          op,
      rotation_angle_z: angle,
      onComplete: ()=> this.animateOnNewNotification(--times, op-1, -angle)
    });
      
  },

  animationEnd: function(time) {
  
    this.notificationIcon.ease({
      duration:         time,
      scale_x:          1.0,
      scale_y:          1.0,
      translation_y:    0,
      opacity:          255,
      rotation_angle_z: 0,
      onComplete: ()=> this.blinkIcon(2*!this.menu.isOpen*this.prefs.get_int("blink-icon"),this.prefs.get_int("blink-time"),255)
    });

  },
    
  arrangeItems: function(pos){

    this.scrollView._delegate = this;
    this.scrollView.add_actor(this.box);
    this.menu.box.add_child(this.scrollView);
    this.addClearButton(0)
        
    if(pos > 0) {
      this.dndItem._delegate = this;
      this.dndItem.connect("toggled", ()=>this.dndToggle());
      this._messageList._dndSwitch.hide();
      this._messageList.get_children()[1].get_children()[1].get_children()[0].hide();
      this.menu.box.insert_child_at_index(this.dndItem, (pos == 1)? 0:2 );
      this.menu.box.insert_child_at_index(new PopupMenu.PopupSeparatorMenuItem(),pos);
    }
    
  },

  autoCloseMenu: function() {

    if(global.display.focus_window!= null && this.menu.isOpen) {
      this.menu.close();
    }

  },
  
  blinkIcon: function(blinkTimes,interval,opacity) {

    this.blinkIconStopIfBlinking(opacity);
    
    if(blinkTimes > 0) {
      this._loopTimeoutId=Mainloop.timeout_add(interval, ()=> this.blinkIcon(--blinkTimes,interval,(opacity==255)?100:255));
    }
    
  },

  blinkIconStopIfBlinking: function(opacity) {

    if(this._loopTimeoutId!=null) {
      Mainloop.source_remove(this._loopTimeoutId);
      this._loopTimeoutId=null;
      this.notificationIcon.set_opacity(opacity);
    }

  },

  dndToggle: function() {

    this.dndpref.set_boolean('show-banners',!this.dndpref.get_boolean('show-banners'));

  },

  filterNotifications: function() {
  
    if(this.isDndOff) {

      let source = Main.messageTray.getSources()[Main.messageTray.getSources().length-1];

      if (this.appBlackList.indexOf(source.title)>=0) {
        switch(this.blackListAction) {
          case 0:
            break ;
          case 1:
            Main.messageTray._bannerBin.visible = false; 
            return;
          case 3:
            Main.messageTray._bannerBin.visible = false; 
          case 2:
            this.notificationCount--;
            return ;
        }
      }

      this.animateOnNewNotification(5);

    }

  },

  indicatorViewShortcut : function() {

    Main.wm.addKeybinding(
      'indicator-shortcut',
      this.prefs,
      MetaKeyBindingFlags.IGNORE_AUTOREPEAT,
      ShellActionMode.NORMAL | ShellActionMode.OVERVIEW | ShellActionMode.POPUP,
      () => {
        this.notificationIcon.visible = !(this.mediaIcon.visible || this.eventsIcon.visible); 
        this.visible = true;
        this.menu.toggle();        
      }

    );

  },

  loadDndStatus: function () {

    this.isDndOff = this.dndpref.get_boolean("show-banners");

    if(this.prefs.get_enum("dnd-position")>0) {
      this.dndItem.setToggleState(!this.isDndOff);
    }

    this.blinkIconStopIfBlinking(255);
    this.manageAutohide();

    this.notificationIcon.icon_name = this.notificationIconName;

    if(this.isDndOff) {
      this.notificationIcon.set_opacity(255);
      this.manageLabel();
      return false;

    }
 
    if(Gtk.IconTheme.get_default()){
      if(Gtk.IconTheme.get_default().has_icon("notifications-disabled-symbolic")) {
        this.notificationIcon.icon_name = "notifications-disabled-symbolic";
      }
    }
    else {
      this.notificationIcon.set_opacity(150);
   }

    Main.messageTray._bannerBin.hide();
    this.notificationLabel.hide();
    this.eventsLabel.hide();
    return true;

  },

  loadPreferences: function() {

    this.autohide                     = this.prefs.get_int("autohide");
    this.mediaSectionToBeShown        = (this.prefs.get_int("show-media")>0)?true:false;
    this.notificationSectionToBeShown = (this.prefs.get_int("show-notification")>0)?true:false;
    this.eventsSectionToBeShown       = (this.prefs.get_int("show-events")>0)?true:false;
    this.hideEmptySpace               = this.prefs.get_enum("beside-calendar")
    this.showEventsInCalendarAlso     = (this.eventsSectionToBeShown)? (this.hideEmptySpace == 0) ? true: false: false;
    this.hideEventsSectionIfEmpty     = !this.prefs.get_boolean("hide-events-section-if-empty");
    this.showThreeIcons               = this.prefs.get_boolean("individual-icons");
    this.includeEventsCount           = this.prefs.get_boolean("include-events-count");
    this.newNotificationAction        = this.prefs.get_enum("new-notification");
    this.menuAutoclose                = this.prefs.get_boolean("autoclose-menu");
    this.eventsSectionhere            = this.showEventsInCalendarAlso;
    this.showingSections              = this.prefs.get_strv("sections-order");
    this.messageListPos               = this.prefs.get_boolean("calendar-on-left") ? 1 : 0;
    this.appBlackList                 = this.prefs.get_strv("name-list");
    this.blackListAction              = this.prefs.get_enum("for-list"); 
    this.animateIcon                  = this.prefs.get_boolean("animate-icon");

  },

  manageAutohide: function() {

    if(this.menu.isOpen) {
      return;
    }

    this.mediaIcon.visible        = this.mediaSection._shouldShow() && this.showThreeIcons && this.mediaSectionToBeShown;
    this.eventsIcon.visible       = (this.shouldShowEventsSection()) && this.showThreeIcons && this.eventsSectionToBeShown;
    this.notificationIcon.visible = (this.notificationSection._list.get_children().length && this.notificationSectionToBeShown) ||
                                    (this.mediaSection._shouldShow() && this.mediaSectionToBeShown && !this.showThreeIcons) ||
                                    ((this.shouldShowEventsSection()) && this.eventsSectionToBeShown && !this.showThreeIcons)||
                                    ((!this.isDndOff)*this.autohide > 1);

    if(this.mediaIcon.visible || this.eventsIcon.visible || this.notificationIcon.visible || !this.autohide) {
      this.visible = true;
      this.notificationIcon.visible = (this.mediaIcon.visible || this.eventsIcon.visible) ? this.notificationIcon.visible : true;
      return;
    }

    this.visible = false;

  },

  manageEvents: function(action) {

    this.eventsSection.visible = this.shouldShowEventsSection() || this.hideEventsSectionIfEmpty;   
    
    if(this.showEventsInCalendarAlso == true) {
      switch(action) {
        case 0:
          if(this.eventsSectionhere == true) {
            return;
          }
          this._removeSection(this.eventsSection);
          this.box.insert_child_at_index(this.eventsSection,this.showingSections.indexOf("events"));
          this.eventsSectionhere = true;
          return;
        case 1:
          if(this.eventsSectionhere == false) {
            return;
          }
          this.box.remove_child(this.box.get_children()[this.showingSections.indexOf("events")]);
          this.newEventsSectionParent.insert_child_at_index(this.eventsSection,0) ;
          this.eventsSectionhere = false;
          return;
      }
    }
  },

  manageLabel:function(nCount,eCount) {

    this.notificationLabel.visible = nCount*this.newNotificationAction;
    this.eventsLabel.visible = eCount*this.newNotificationAction && (this.shouldShowEventsSection() > 0);

    if (this.prefs.get_boolean("change-icons")) {
        this.manageIconChange(nCount > 0 || eCount > 0);
    }

    if(this.newNotificationAction == 2) {

        if(nCount>0) {
          this.notificationLabel.text=nCount.toString()+" ";
        }
        if(eCount > 0 ) {
          this.eventsLabel.text=eCount.toString()+" ";
        }

    }

  },

  manageIconChange: function(statusIcon) {

    let iconName = statusIcon ? "notification-center-full" : "notification-center-empty";

    this.notificationIcon.icon_name = iconName;
    
  },

  middleClickDndToggle: function (actor, event) {

    switch(event.get_button()) {

      case 2: // if middle click

        // close the menu, since it gets open on any click
        if (this.menu.isOpen) {
          this.menu.actor.hide();
        }
        // toggle DND state
        this.dndToggle();
        // reload dnd status
        this.loadDndStatus();

        return;

      }

  },

  newNotif: function(messageType) {

    Main.messageTray._bannerBin.visible = true;

    switch(messageType) {
      case "media":
        this.mediaCount++;
        break;
      case "notification" :
        this.notificationCount = this.notificationCount+ !this.menu.isOpen;
        this.filterNotifications();
        break;
      case "events" :
        this.eventsCount = this.eventsCount + !this.menu.isOpen;
        break;
    }
    this.resetIndicator();

  },
 
  rebuildMessageList: function() {

    this._messageListParent.remove_actor(this._messageList); 
    this._messageListParent.insert_child_at_index(this._messageList,this.messageListPos);

    for(let i=0;i<this.showingSections.length;i++) {

      if(this.showingSections[i] == "events") {
        this.newEventsSectionParent.remove_actor(this.eventsSection);
        this.box.add(this.eventsSection);
        this.connectedSignals.push(this.eventsSection._eventsList.connect('actor-added'   ,()=> this.newNotif(this.showingSections[i]) ));
        this.connectedSignals.push(this.eventsSection._eventsList.connect('actor-removed' ,()=> this.remNotif(this.showingSections[i]) ));
      }    
      else {
        this._removeSection(this[this.showingSections[i]+"Section"]);
        this.box.add(this[this.showingSections[i]+"Section"]);
        this.connectedSignals.push(this[this.showingSections[i]+"Section"]._list.connect('actor-added'   ,()=> this.newNotif(this.showingSections[i]) ));
        this.connectedSignals.push(this[this.showingSections[i]+"Section"]._list.connect('actor-removed' ,()=> this.remNotif(this.showingSections[i]) ));

      }
      this[this.showingSections[i]+"Section"].add_style_class_name('notification-center-message-list-section');
    }

  },

  remNotif: function(messageType) {

    switch(messageType) {
      case "media" :
        this.mediaCount--;
        break;
      case "notification" :
        (this.notificationCount>0)? this.notificationCount-- : 0;
        break;
      case "events" :
        (this.eventsCount>0)? this.eventsCount-- : 0;
        break;
    }
    this.resetIndicator();

  },

  removeAndDisconnectSections : function() {

    let len=this.showingSections.length;
    while(len!=0) {
    
      if(this.showingSections[len-1] == "events") {

        this[this.showingSections[len-1]+"Section"]._eventsList.disconnect(this.connectedSignals[2*len-1]);
        this[this.showingSections[len-1]+"Section"]._eventsList.disconnect(this.connectedSignals[2*len-2]);

        this.box.remove_child(this.box.get_children()[len-1]);
        this.newEventsSectionParent.add_actor(this.eventsSection);
      }    
      
      else {
        this[this.showingSections[len-1]+"Section"]._list.disconnect(this.connectedSignals[2*len-1]);
        this[this.showingSections[len-1]+"Section"]._list.disconnect(this.connectedSignals[2*len-2]);

        this.box.remove_child(this.box.get_children()[len-1]);
        this._messageList._addSection(this[this.showingSections[len-1]+"Section"]);
     }
      this[this.showingSections[len-1]+"Section"].remove_style_class_name('notification-center-message-list-section');
      this.connectedSignals.pop();
      this.connectedSignals.pop();
      
      len--;
    }

  },

  removeDotAndBorderFromDateMenu: function() {

    Main.panel.statusArea.dateMenu.get_children()[0].remove_actor(Main.panel.statusArea.dateMenu._indicator)
    this.dtActors=Main.panel.statusArea.dateMenu.get_children()[0].get_children();
    Main.panel.statusArea.dateMenu.get_children()[0].remove_actor(this.dtActors[0]);
    
    if(this.showingSections.length == 3 && !this.showEventsInCalendarAlso) {
      this._messageListParent.get_children()[1].style="border-width: 0px";
    }
     
  },
  
  _removeSection(section) {

    if(section == this.eventsSection) {
      this.newEventsSectionParent.remove_actor(this.eventsSection);
      return ;
    } 

    this._messageList._sectionList.remove_actor(section);
    this._messageList._sync();

  },

  resetIndicator: function() {

    this.manageAutohide();
    this.clearButton.visible = this.notificationSection._canClear && this.notificationSectionToBeShown;

    this.eventsCount=this.eventsCount*this.includeEventsCount;                                                
                                                    
    if(this.isDndOff) {
      this.manageLabel((this.notificationCount + (!this.showThreeIcons)*this.eventsCount) ,(this.showThreeIcons)*this.eventsCount);
    }

  },

  _onOpenStateChanged: function(menu,open) {

    if(!open) {
      this.resetIndicator();
      this.remove_style_pseudo_class('active');
      return ;
    }

    this.add_style_pseudo_class('active');
    this.manageEvents(0);
    [ this.mediaSection.visible, this.notificationSection.visible ] = [ true, true ];
    this.blinkIconStopIfBlinking(255);

    if(!this.prefs.get_boolean("show-label")) {
      this.notificationCount=0;
      this.eventsCount=0;
    }

    this.resetIndicator();

  },

  setNotificationIconName: function () {
    if(Gtk.IconTheme.get_default()) {
    this.notificationIconName = Gtk.IconTheme.get_default().has_icon("notification-symbolic")?"notification-symbolic":"preferences-system-notifications-symbolic";
    }
    else {
      this.notificationIconName = "preferences-system-notifications-symbolic";
    }
  },

  iconThemeChanged: function() {
    this.setNotificationIconName();
    this.loadDndStatus();
  },
  
  shouldShowEventsSection: function() {
  
    switch(this.eventsSection._eventsList.get_children().length) {
      case 0:
        return 0;
      default:
        return (this.eventsSection._eventsList.get_children()[0].text == _("No Events")) ? 0: this.eventsSection._eventsList.get_children().length;
    }
  
  },  

  startNotificationCenter: function() {

    this._indicator.add_child(this.eventsIcon);
    this._indicator.add_child(this.eventsLabel);
    this._indicator.add_child(this.mediaIcon);
    this._indicator.add_child(this.notificationIcon);
    this._indicator.add_child(this.notificationLabel);

    this.setNotificationIconName();
    this.iconThemeChangeSig = this.textureCache.connect('icon-theme-changed', this.iconThemeChanged.bind(this));

    this.add_child(this._indicator);
    Main.panel.addToStatusArea("NotificationCenter", this, this.prefs.get_int('indicator-index'), this.prefs.get_string('indicator-pos'));

    this.rebuildMessageList();
    this.arrangeItems(this.prefs.get_enum("dnd-position"));
    
    this.loadDndStatus();
    this.resetIndicator();

    Main.messageTray.bannerAlignment = this.prefs.get_enum('banner-pos');

    this.removeDotAndBorderFromDateMenu();
    this.indicatorViewShortcut();

    this.dndSig = this.dndpref.connect("changed::show-banners", () => {
      this.loadDndStatus();
    });

    if(this.prefs.get_boolean("middle-click-dnd")) {
      this.connect("button-press-event", (actor, event)=>this.middleClickDndToggle(actor, event));
    }

    if(this.hideEmptySpace != 1) {
      this.dmSig=Main.panel.statusArea.dateMenu.menu.connect("open-state-changed",()=> {

        Main.panel.statusArea.dateMenu._calendar.setDate(new Date());
        if (Main.panel.statusArea.dateMenu.menu.isOpen) {
          switch(this.hideEmptySpace) {
            case 0: 
              this.manageEvents(1);
              if(this.prefs.get_boolean("show-label")==false) {
                this.eventsCount=0;
              }
              break;
              
            default:
              if(((!this.mediaSectionToBeShown && this.mediaSection._shouldShow())||(!this.notificationSectionToBeShown && this.notificationSection._list.get_children().length)||(!this.eventsSectionToBeShown && ( this.shouldShowEventsSection() ) ))) {
                if(this.messageListRemoved) {
                  this._messageListParent.insert_child_at_index(this._messageList,this.messageListPos);
                  this.messageListRemoved = false;
                }
              }
              else {
                if(!this.messageListRemoved) {
                   this._messageListParent.remove_actor(this._messageList); 
                  this.messageListRemoved = true;
                }                
              }
          }
        
        }

        this.resetIndicator();
      });
    }

    if(this.menuAutoclose) {
      this.cmsig = global.display.connect('notify::focus-window', () => this.autoCloseMenu());
    }
    
    this.defaultWeatherItemVisibility = Main.panel.statusArea.dateMenu._weatherItem.visible;
    Main.panel.statusArea.dateMenu._weatherItem.visible = !this.prefs.get_boolean("hide-weather-section") && this.defaultWeatherItemVisibility;
     
    this.defaultClocksItemVisibility = Main.panel.statusArea.dateMenu._clocksItem.visible; 
    Main.panel.statusArea.dateMenu._clocksItem.visible =  !this.prefs.get_boolean("hide-clock-section") && this.defaultClocksItemVisibility;
    
    this.defaultDateVisibility = Main.panel.statusArea.dateMenu._date.visible; 
    Main.panel.statusArea.dateMenu._date.visible =  !this.prefs.get_boolean("hide-date-section") && this.defaultDateVisibility; 
    
  },
  
  undoChanges: function () {

    this.blinkIconStopIfBlinking(255);

    if(this.messageListRemoved) {   
      this._messageListParent.insert_child_at_index(this._messageList,0); 
      this.messageListRemoved = false; 
    }
    else {
      this._messageListParent.remove_actor(this._messageList); 
      this._messageListParent.insert_child_at_index(this._messageList,0);
    }
    
    this._messageListParent.get_children()[1].style="";
    
    this._messageList._dndSwitch.show();
    this._messageList._dndButton.label_actor.show();
    
    this.manageEvents(0);
    this.removeAndDisconnectSections();

    this._removeSection(this.mediaSection);
    this._removeSection(this.notificationSection);
    this._removeSection(this.eventsSection);
 
    this._messageList._addSection(this.mediaSection);
    this._messageList._addSection(this.notificationSection);
    this.newEventsSectionParent.insert_child_at_index(this.eventsSection,0) ;

    Main.messageTray._bannerBin.show();
    Main.messageTray.bannerAlignment = 2;

    if(this.hideEmptySpace != 1) {
      Main.panel.statusArea.dateMenu.menu.disconnect(this.dmSig);
    }

    if(this.menuAutoclose) {
       global.display.disconnect(this.cmsig);
    }

    if(this.dndSig!=null){
      this.dndpref.disconnect(this.dndSig);
      this.dndItem.destroy();
    }

    if(this.iconThemeChangeSig!=null){
      this.textureCache.disconnect(this.iconThemeChangeSig);
    }

    Main.panel.statusArea.dateMenu.get_children()[0].insert_child_at_index(this.dtActors[0],0);
    Main.panel.statusArea.dateMenu.get_children()[0].add_actor(Main.panel.statusArea.dateMenu._indicator) 

    Main.panel.statusArea.dateMenu._weatherItem.visible = this.defaultWeatherItemVisibility;
    Main.panel.statusArea.dateMenu._clocksItem.visible  = this.defaultClocksItemVisibility;
    Main.panel.statusArea.dateMenu._date.visible        = this.defaultDateVisibility;

    Main.wm.removeKeybinding('indicator-shortcut');

    this.eventsIcon.destroy();
    this.eventsLabel.destroy();
    this.mediaIcon.destroy();
    this.notificationIcon.destroy();
    this.notificationLabel.destroy();
    this._indicator.destroy();

    this.clearButton.destroy();
    this.box.destroy();
    this.scrollView.destroy();

    this.prefs.disconnect(this.reloadSignal);
    this.prefs.disconnect(this.reloadProfilesSignal);

  },
  
});


