'use strict';

/*
 * A module for adding new a routing system Angular 1.
 */
angular.module('ngNewRouter', [])
  .factory('$router', routerFactory)
  .value('$routeParams', {})
  .provider('$componentLoader', $componentLoaderProvider)
  .factory('$$pipeline', pipelineFactory)
  .directive('ngViewport', ngViewportDirective)
  .directive('ngViewport', ngViewportFillContentDirective)
  .directive('ngLink', ngLinkDirective)
  .directive('a', anchorLinkDirective);


/*
 * A module for inspecting controller constructors
 */
angular.module('ng')
  .provider('$controllerIntrospector', $controllerIntrospectorProvider)
  .config(controllerProviderDecorator);

/*
 * decorates with routing info
 */
function controllerProviderDecorator($controllerProvider, $controllerIntrospectorProvider) {
  var register = $controllerProvider.register;
  $controllerProvider.register = function (name, ctrl) {
    $controllerIntrospectorProvider.register(name, ctrl);
    return register.apply(this, arguments);
  };
}

/*
 * private service that holds route mappings for each controller
 */
function $controllerIntrospectorProvider() {
  var controllers = [];
  var onControllerRegistered = null;
  return {
    register: function (name, constructor) {
      if (angular.isArray(constructor)) {
        constructor = constructor[constructor.length - 1];
      }
      if (constructor.$routeConfig) {
        if (onControllerRegistered) {
          onControllerRegistered(name, constructor.$routeConfig);
        } else {
          controllers.push({name: name, config: constructor.$routeConfig});
        }
      }
    },
    $get: ['$componentLoader', function ($componentLoader) {
      return function (newOnControllerRegistered) {
        onControllerRegistered = function (name, constructor) {
          name = $componentLoader.component(name);
          return newOnControllerRegistered(name, constructor);
        };
        while(controllers.length > 0) {
          var rule = controllers.pop();
          onControllerRegistered(rule.name, rule.config);
        }
      }
    }]
  }
}

function routerFactory($$rootRouter, $rootScope, $location, $$grammar, $controllerIntrospector) {

  $controllerIntrospector(function (name, config) {
    $$grammar.config(name, config);
  });

  $rootScope.$watch(function () {
    return $location.path();
  }, function (newUrl) {
    $$rootRouter.navigate(newUrl);
  });

  var nav = $$rootRouter.navigate;
  $$rootRouter.navigate = function (url) {
    return nav.call(this, url).then(function (newUrl) {
      if (newUrl) {
        $location.path(newUrl);
      }
    });
  }

  return $$rootRouter;
}

/**
 * @name ngViewport
 *
 * @description
 * An ngViewport is where resolved content goes.
 *
 * ## Use
 *
 * ```html
 * <div router-viewport="name"></div>
 * ```
 *
 * The value for the `ngViewport` attribute is optional.
 */
function ngViewportDirective($animate, $compile, $controller, $templateRequest, $rootScope, $location, $componentLoader, $router) {
  var rootRouter = $router;

  return {
    restrict: 'AE',
    transclude: 'element',
    terminal: true,
    priority: 400,
    require: ['?^^ngViewport', 'ngViewport'],
    link: viewportLink,
    controller: function() {},
    controllerAs: '$$ngViewport'
  };

  function viewportLink(scope, $element, attrs, ctrls, $transclude) {
    var viewportName = attrs.ngViewport || 'default',
        parentCtrl = ctrls[0],
        myCtrl = ctrls[1],
        router = (parentCtrl && parentCtrl.$$router) || rootRouter;

    var currentScope,
        newScope,
        currentController,
        currentElement,
        previousLeaveAnimation,
        previousInstruction;

    function cleanupLastView() {
      if (previousLeaveAnimation) {
        $animate.cancel(previousLeaveAnimation);
        previousLeaveAnimation = null;
      }

      if (currentScope) {
        currentScope.$destroy();
        currentScope = null;
      }
      if (currentElement) {
        previousLeaveAnimation = $animate.leave(currentElement);
        previousLeaveAnimation.then(function() {
          previousLeaveAnimation = null;
        });
        currentElement = null;
      }
    }

    router.registerViewport({
      canDeactivate: function (instruction) {
        if (currentController && currentController.canDeactivate) {
          return currentController.canDeactivate();
        }
        return true;
      },
      activate: function (instruction) {
        var nextInstruction = serializeInstruction(instruction);
        if (nextInstruction === previousInstruction) {
          return;
        }

        newScope = scope.$new();
        myCtrl.$$router = instruction.router;
        myCtrl.$$template = instruction.template;
        var componentName = instruction.component;
        var clone = $transclude(newScope, function(clone) {
          $animate.enter(clone, null, currentElement || $element);
          cleanupLastView();
        });

        var ctrl = instruction.controller;
        newScope[componentName] = ctrl;
        currentController = ctrl;

        currentElement = clone;
        currentScope = newScope;

        previousInstruction = nextInstruction;

        // finally, run the hook
        if (ctrl.activate) {
          ctrl.activate(instruction);
        }
      }
    }, viewportName);
  }

  // TODO: how best to serialize?
  function serializeInstruction(instruction) {
    return JSON.stringify({
      path: instruction.path,
      component: instruction.component,
      params: Object.keys(instruction.params).reduce(function (acc, key) {
        return (key !== 'childRoute' && (acc[key] = instruction.params[key])), acc;
      }, {})
    });
  }
}

function ngViewportFillContentDirective($compile) {
  return {
    restrict: 'EA',
    priority: -400,
    require: 'ngViewport',
    link: function(scope, $element, attrs, ctrl) {
      var template = ctrl.$$template;
      $element.html(template);
      var link = $compile($element.contents());
      link(scope);
    }
  };
}

function makeComponentString(name) {
  return [
    '<router-component component-name="', name, '">',
    '</router-component>'
  ].join('');
}


var LINK_MICROSYNTAX_RE = /^(.+?)(?:\((.*)\))?$/;
/**
 * @name ngLink
 * @description
 * Lets you link to different parts of the app, and automatically generates hrefs.
 *
 * ## Use
 * The directive uses a simple syntax: `router-link="componentName({ param: paramValue })"`
 *
 * ## Example
 *
 * ```js
 * angular.module('myApp', ['ngFuturisticRouter'])
 *   .controller('AppController', ['router', function(router) {
 *     router.config({ path: '/user/:id' component: 'user' });
 *     this.user = { name: 'Brian', id: 123 };
 *   });
 * ```
 *
 * ```html
 * <div ng-controller="AppController as app">
 *   <a router-link="user({id: app.user.id})">{{app.user.name}}</a>
 * </div>
 * ```
 */
function ngLinkDirective($router, $location, $parse) {
  var rootRouter = $router;

  return {
    require: '?^^ngViewport',
    restrict: 'A',
    link: ngLinkDirectiveLinkFn
  };

  function ngLinkDirectiveLinkFn(scope, elt, attrs, ctrl) {
    var router = (ctrl && ctrl.$$router) || rootRouter;
    if (!router) {
      return;
    }

    var link = attrs.ngLink || '';
    var parts = link.match(LINK_MICROSYNTAX_RE);
    var routeName = parts[1];
    var routeParams = parts[2];
    var url;

    if (routeParams) {
      var routeParamsGetter = $parse(routeParams);
      // we can avoid adding a watcher if it's a literal
      if (routeParamsGetter.constant) {
        var params = routeParamsGetter();
        url = '.' + router.generate(routeName, params);
        elt.attr('href', url);
      } else {
        scope.$watch(function() {
          return routeParamsGetter(scope);
        }, function(params) {
          url = '.' + router.generate(routeName, params);
          elt.attr('href', url);
        }, true);
      }
    } else {
      url = '.' + router.generate(routeName);
      elt.attr('href', url);
    }
  }
}


function anchorLinkDirective($router) {
  return {
    restrict: 'E',
    link: function(scope, element) {
      // If the linked element is not an anchor tag anymore, do nothing
      if (element[0].nodeName.toLowerCase() !== 'a') return;

      // SVGAElement does not use the href attribute, but rather the 'xlinkHref' attribute.
      var hrefAttrName = toString.call(element.prop('href')) === '[object SVGAnimatedString]' ?
                     'xlink:href' : 'href';

      element.on('click', function(event) {
        var href = element.attr(hrefAttrName);
        if (!href) {
          event.preventDefault();
        }
        if ($router.recognize(href)) {
          $router.navigate(href);
          event.preventDefault();
        }
      });
    }
  }
}

function pipelineFactory($controller, $componentLoader, $templateRequest) {
  return {
    init: function(instruction) {
      var controllerName = $componentLoader.controllerName(instruction.component);

      var locals = {
        $router: instruction.router,
        $routeParams: instruction.params || {}
      };
      var ctrl;
      try {
        ctrl = $controller(controllerName, locals);
      } catch (e) {
        console.warn && console.warn('Could not instantiate controller', controllerName);
        ctrl = $controller(angular.noop, locals);
      }
      return ctrl;
    },
    load: function (instruction) {
      var componentTemplateUrl = $componentLoader.template(instruction.component);
      return $templateRequest(componentTemplateUrl);
    }
  };
}

/**
 * @name $componentLoaderProvider
 * @description
 *
 * This lets you configure conventions for what controllers are named and where to load templates from.
 *
 * The default behavior is to dasherize and serve from `./components`. A component called `myWidget`
 * uses a controller named `MyWidgetController` and a template loaded from `./components/my-widget/my-widget.html`.
 *
 * A component is:
 * - a controller
 * - a template
 * - an optional router
 *
 * This service makes it easy to group all of them into a single concept.
 */
function $componentLoaderProvider() {

  var DEFAULT_SUFFIX = 'Controller';

  var componentToCtrl = function componentToCtrlDefault(name) {
    return name[0].toUpperCase() + name.substr(1) + DEFAULT_SUFFIX;
  };

  var componentToTemplate = function componentToTemplateDefault(name) {
    var dashName = dashCase(name);
    return './components/' + dashName + '/' + dashName + '.html';
  };

  var ctrlToComponent = function ctrlToComponentDefault(name) {
    return name[0].toLowerCase() + name.substr(1, name.length - DEFAULT_SUFFIX.length - 1);
  };

  return {
    $get: function () {
      return {
        controllerName: componentToCtrl,
        template: componentToTemplate,
        component: ctrlToComponent
      };
    },

    /**
     * @name $componentLoaderProvider#setCtrlNameMapping
     * @description takes a function for mapping component names to component controller names
     */
    setCtrlNameMapping: function(newFn) {
      componentToCtrl = newFn;
      return this;
    },

    /**
     * @name $componentLoaderProvider#setCtrlNameMapping
     * @description takes a function for mapping component controller names to component names
     */
    setComponentFromCtrlMapping: function (newFn) {
      ctrlToComponent = newFn;
      return this;
    },

    /**
     * @name $componentLoaderProvider#setTemplateMapping
     * @description takes a function for mapping component names to component template URLs
     */
    setTemplateMapping: function(newFn) {
      componentToTemplate = newFn;
      return this;
    }
  };
}

function dashCase(str) {
  return str.replace(/([A-Z])/g, function ($1) {
    return '-' + $1.toLowerCase();
  });
}
