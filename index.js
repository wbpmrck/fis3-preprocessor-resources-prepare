/**
 * Created by cuikai on 2015/9/28.
 * 对于js:
 • 分析js的subpath路径，作为默认的moduleId
 • 分析alia声明
 • 进行commonjs包裹，define内id的生成
 • 修改require和require.async里的依赖项，为subpath,方便后续拿到依赖文本内容

 * 对于html:
 • 处理component嵌入
 • 对html里引用的其他js,进行标签上的jspath设置，这样保证以后可以根据绝对路径获取html依赖的js名称

 */


var cheerio = require('cheerio'),
    utils = require("./libs/utils")
    ;
var fs = require('fs'),
    pth = require('path'),
    _exists = fs.existsSync || pth.existsSync;


var utilNode = require("util");
var codeRegex = require("./libs/codeRegex.js");
var dependency = require("./libs/dependency.js");

var inlineRecords={}; //key:html file  value:seed in that file


//初始化fis全局数据项
fis._ckdata = fis._ckdata || {};

fis._ckdata.allAlias={}; //key:alia  value :moduleId
fis._ckdata.allModules ={}; //key:moduleId  value:<module>
fis._ckdata.allModulesFile ={}; //key:moduleId  value:<file>

fis._ckdata.pathToModuleId={}; //key:fullpath  value:moduleId
fis._ckdata.pathToAlias={}; //key:subpath  value :alia



function analyzeAlia(file){
//首先检查页面上的alia申明
    var alia = codeRegex.getAlia(file.getContent());
    if(alia !== false){
        //有alia申明的，更新别名字典，同时检查是否有冲突
        if(fis._ckdata.allAlias.hasOwnProperty(alia) && fis._ckdata.allAlias[alia]!=file.subpath){
            throw new Error("Alia:["+alia+'] has been used by['+ fis._ckdata.allAlias[alia] +']! please check!')
        }else{
            //如果没冲突，则注册当前别名到字典
            console.log("resources-prepare>> 更新别名:"+alia," <--> "+file.subpath);
            fis._ckdata.allAlias[alia] = file.subpath;
            fis._ckdata.pathToAlias[file.subpath] = alia;

            file.__alia__ = alia;
        }
        return alia;
    }else{
        return false;
    }
}

/**
 * 获取js文件的模块Id,如果有别名，则用别名代替(过程中保存文件的原始moduleId)
 * @param file
 * @param isInline:表示传入的文件是不是一个内联js(这个参数是由于fis对内联js的处理不确定性导致加上的2015-09-28)
 * @returns {*}
 */
function getModuleIdForDefine(file,isInline){

    var moduleId;

    //如果是html内部嵌入的js文件，则使用html文件名+seed的方式表示js模块名
    if(isInline || pth.extname(file.basename)!==".js" && file.isJsLike){
        if(!inlineRecords.hasOwnProperty(file.subpath)){
            inlineRecords[file.subpath]=0
        }
        inlineRecords[file.subpath]++;
        moduleId= file.subpath+"."+inlineRecords[file.subpath].toString();
    }else{
        moduleId= file.subpath;
    }

    fis._ckdata.allModules[moduleId]={
        fullname:file.fullname, //模块绝对路径
        uri:undefined,//模块发布url
        deps:[],//模块同步依赖
        asyncUse:[]//模块异步依赖
    };//初始化module信息

    fis._ckdata.allModulesFile[moduleId] = file;
    fis._ckdata.pathToModuleId[file.fullname.replace(/\\/g, "/")] = moduleId;
    //fis._ckdata.pathToModuleId[file.subpath.replace(/\\/g, "/")] = moduleId;

    console.log("getModuleIdForDefine->"+moduleId);
    file.__moduleId__ = moduleId;

    //分析别名：
    var alia = analyzeAlia(file);
    if(alia !== false){
        //有别名，则对外部返回别名
        fis._ckdata.allModules[moduleId].alia=alia; //记录别名到模块信息表


        //对于有别名的模块，别名也单独作为一个模块来管理（方便最后生成前端loader可识别的srcMap)
        fis._ckdata.allModules[alia]={
            fullname:file.fullname, //模块绝对路径
            uri:undefined,//模块发布url
            deps:[],//模块同步依赖
            asyncUse:[]//模块异步依赖
        };//初始化module信息
        fis._ckdata.allModulesFile[alia] = file;

        return alia

    }else{
        //没有别名，就使用模块本身的moduleId
        return moduleId;
    }
}



/**
 * 内部函数:检查引用的component地址是否合法：
 * component约定：
 * 1、以相对路径引用，比如../components/header
 * 2、component下面，应该有与文件夹同名的html,如：header.html(后缀名可以配置)
 * 3、component如果使用了js,css,也应当与文件夹同名(css,js内部可以依赖其他css,js,但是对于组件来说，入口样式是)
 * @param componentRealPath:组件的绝对路径
 * @param settings:插件配置，目前有:
 *      templateExt:约定组件的html模板后缀名
 * @returns {boolean} :是否是有效的组件引用
 */
function checkComponentIsValid(componentRealPath,settings){
    //首先检查路径是否规范
    if(utils.isDir(componentRealPath)){
        var templatePath = pth.join(componentRealPath,pth.basename(componentRealPath)+settings.templateExt);
        //console.log("templatePath:"+templatePath);
        if(_exists(templatePath)){
            return true
        }
        else{
            return false;
        }
    }else{
        console.log("checkComponentIsValid failed:"+componentRealPath+" is not a dir!");
        return false;
    }

    return true;
}

/**
 * 获取组件的样式表路径
 * @param componentRealPath
 * @param settings
 * @returns {String}
 */
function getComponentCssPath(componentRealPath,settings){
    if(utils.isDir(componentRealPath)){
        var cssPath = pth.join(componentRealPath,pth.basename(componentRealPath)+settings.cssExt);
        if(_exists(cssPath)){
            return cssPath
        }
        else{
            return undefined;
        }
    }else{
        return undefined;
    }
}

/**
 * 获取组件的js路径
 * @param componentRealPath
 * @param settings
 * @returns {String}
 */
function getComponentJsPath(componentRealPath,settings){
    if(utils.isDir(componentRealPath)){
        var jsPath = pth.join(componentRealPath,pth.basename(componentRealPath)+settings.jsExt);
        if(_exists(jsPath)){
            return jsPath
        }
        else{
            return undefined;
        }
    }else{
        return undefined;
    }
}



var defaultSettings={
    commonLibs:[
        '/libs/onelib/OneLib.Log.js',
        '/libs/onelib/OneLib.EventEmitter.js',
        '/libs/onelib/OneLib.ScriptLoader.js',
        '/libs/onelib/OneLib.CMDSyntax.js'
    ],
    templateExt:".html", //约定组件的html模板后缀名
    cssExt:".css", //约定组件的样式后缀名
    jsExt:".js" //约定组件的脚本后缀名
};

/**
 * 给页面的所有js脚本添加subpath属性，用于在后面的插件中，通过分析脚本subpath属性拿到脚本的绝对路径
 * @param htmlFile:脚本所在页面
 * @param htmlJQueryFile
 */
function addScriptsJsPath(htmlFile,htmlJQueryFile){
    var $ = htmlJQueryFile;
    var script =$('script[type="text/javascript"]');

    for(var i=0,j=script.length;i<j;i++) {
        var _scriptItem = $(script[i]);
        if(_scriptItem.attr('src')){
            //如果有src标签，则通过相对路径设置
            if(!_scriptItem.attr("jspath")){
                //var subpath = pth.relative(fis.project.getProjectPath(),pth.resolve(htmlFile.dirname,_scriptItem.attr('src')));
                var fullpath = pth.resolve(htmlFile.dirname,_scriptItem.attr('src')).replace(/\\/g, "/");
                _scriptItem.attr("jspath",fullpath);
            }
        }else{
            //否则设置为html的路径
            //防止覆盖
            if(!_scriptItem.attr("jspath")){
                _scriptItem.attr("jspath",htmlFile.fullname);
            }
        }
    }
}


/**
 * 给页面添加前置脚本，这些脚本必须在所有脚本之前运行，且每个页面都有
 * @param htmlJqueryObj
 * @param settings
 * @param getSrcFunc:这个函数接受一个参数是moduleId,返回module的发布地址
 * @param srcMap:这是配置OneLib.CMDSyntax.setSrcMap的 数据对象，如果传入，则插入在其他脚本之前（则表示该脚本由构建工具自动插入）
 *                      当然，也可以由开发人员自己用占位符 _SRC_MAP_ 来自定插入位置
 */
function addPredefineScript(file,htmlJqueryObj,settings,getSrcFunc,srcMap){

    var $ = htmlJqueryObj;
    //获取页面上第一个脚本
    var firstScript =$('script[type="text/javascript"]').first();

    //在页面上第一个自定义脚本上，加入一个占位符，用于在用户没有自定义srcMap占位符的时候，进行替换：
    firstScript.attr("isfirstbizscript",true);

    //将需要提前加载的脚本生成，并插入
    if(settings.commonLibs){
        for(var i=0,j=settings.commonLibs.length;i<j;i++){
            var _item = settings.commonLibs[i];

            var _jsLink = $('<script type="text/javascript"/>');
            var relativePath = pth.relative(file.dirname,fis.project.getProjectPath()+_item).replace(/\\/g, "/");
            _jsLink.attr('src',relativePath);
            _jsLink.attr('predefined',true);//这个标记用于防止最后重设脚本的时候，删除这些预置脚本（因为预置脚本的依赖关系不可知，只有靠初始化的顺序保证）
            _jsLink.insertBefore(firstScript);


        }
        //var placeHolder = $('<span style="display:none" id="__SRC_MAP__"></span>');
        //placeHolder.insertBefore
    }
}


function wrapJsModule(file,content,fileModuleId){

    //第1步：给模块进行CMD格式包裹
    //console.log("postprocessor-commonjs-wrap do file:["+file.subpath+']');
    content = '\r\ndefine("' +fileModuleId +
        '",function(require,exports,module){\r\n' +
        content + '\r\n });';

    //第2步：替换里面的require
    content = codeRegex.replaceRequire(content, function (moduleId) {
        //拿到解析出来的moduleId,先查找有没有这个文件
        var dependPath = pth.resolve(file.dirname,moduleId);

        //console.log('dependPath = '+dependPath);
        //如果文件存在，则包裹为file对象
        //if(pth.existsSync(dependPath)){
        if(_exists(dependPath)){
            var dependFile  = fis.file.wrap(dependPath);
            if(dependFile){
                console.log("resources-prepare>> 替换文件:["+file.subpath+"] 里面的require: "+moduleId+" 为: "+dependFile.subpath);
                return dependFile.subpath //如果引用的文件在工程中存在，则使用该文件的subpath
            }
            else{
                throw new Error("commonjs-wrap:"+"wrap file "+dependFile+" failed!")
            }
        }else{
            console.log("resources-prepare>> 保留文件:["+file.subpath+"] 里面的require: "+moduleId);
            return moduleId; //如果引用的文件在工程中不存在，则考虑可能是通过别名引用的，保留不改，在fix插件中去检验
        }
    });


    //第3步：替换里面的require.async
    content = codeRegex.replaceRequireAsync(content, function (moduleId) {
        //拿到解析出来的moduleId,先查找有没有这个文件
        var dependPath = pth.resolve(file.dirname,moduleId);

        //console.log('dependPath = '+dependPath);

        //如果文件存在，则包裹为file对象
        if(_exists(dependPath)){
            var dependFile  = fis.file.wrap(dependPath);
            if(dependFile){
                console.log("resources-prepare>> 替换文件:["+file.subpath+"]里面的require.async: "+moduleId+" 为: "+dependFile.subpath);
                return dependFile.subpath //如果引用的文件在工程中存在，则使用该文件的subpath
            }
            else{
                throw new Error("commonjs-wrap:"+"wrap file "+dependFile+" failed!")
            }
        }else{
            console.log("resources-prepare>> 保留文件:["+file.subpath+"] 里面的require.async: "+moduleId);
            return moduleId; //如果引用的文件在工程中不存在，则考虑可能是通过别名引用的，保留不改，在fix插件中去检验
        }
    });
    return content;
}

function dealwithComponentEmbed(file,htmlFileJqueryObject,settings){
    var $ = htmlFileJqueryObject;
    // 先检查component使用情况
    // 如果有这个标签，则表示页面使用到了component
    var link_component = $("link[rel=component]");
    if(link_component && link_component.length>0){
        for(var i=0,j=link_component.length;i<j;i++){
            var _link = $(link_component[i]);

            var   _link_placeholder_pre = $("<a class='__placeholder__pre' id='c_p_"+i+"'></a>");
            _link_placeholder_pre.insertBefore(_link);//用一个placeholder占位在原来link的地方,因为后面link会被内容覆盖

            var   _link_placeholder_aft = $("<a class='__placeholder__aft' id='c_a_"+i+"'></a>");
            _link_placeholder_aft.insertAfter(_link);//link after


            //获取引用组件的绝对路径
            var _abPath = pth.resolve(file.dirname,_link.attr("href")),
                _componentDir = _link.attr("href");
                
                // console.log("_abPath:"+_abPath);
                // console.log("_componentDir:"+_componentDir);


            //如果引用的文件夹符合component规范，则继续
            if(checkComponentIsValid(_abPath,settings)){

                var templatePath = pth.join(_componentDir,pth.basename(_abPath)+settings.templateExt);
                var templateFullPath = pth.join(_abPath,pth.basename(_abPath)+settings.templateExt);


                //这里使用fis的资源内嵌语法，直接把html嵌入了
                _link.attr("rel","import").attr("href",templatePath+"?__inline");
                //再追加对css,js的引用


                //看控件是否含有 css
                var cssPath = getComponentCssPath(_abPath,settings);
                if(cssPath){
                    //在html之前加一个css标签
                    var _cssLink = $('<link rel="stylesheet" />');
                    _cssLink.attr('href',pth.join(_componentDir,pth.basename(_abPath)+settings.cssExt));
                    _cssLink.insertBefore("#c_p_"+i);
                }


                //看控件是否含有javascript
                var jsPath = getComponentJsPath(_abPath,settings);
                if(jsPath){
                    //把它的js文件嵌入到页面上
                    var _jsLink = $('<script type="text/javascript"/>');
                    _jsLink.attr("from",pth.basename(_abPath));
                    _jsLink.attr("jspath",jsPath);
                    _jsLink.attr('src',pth.join(_componentDir,pth.basename(_abPath)+settings.jsExt));
                    _jsLink.insertAfter("#c_a_"+i);

                }
                $(".__placeholder__pre").remove();
                $(".__placeholder__aft").remove();
            }else{
                throw new Error("path:"+_abPath+" is not a component! check the directory files! ");
            }
        }
    }
}

var callTimes ={}; //key: subpath value:count
var count = 0;
/**
 * 插件入口函数，被fis框架调用
 * @param content:fis获取到的文件内容string
 * @param file:fis的文件对象
 * @param settings:插件配置，目前有:
 *      templateExt:约定组件的html模板后缀名
 * @returns {*}
 */
var _ =module.exports = function (content, file, settings) {
    //count++;
    //callTimes[file.subpath] = callTimes.hasOwnProperty(file.subpath)?callTimes[file.subpath]+1:1;
    //
    console.log("resources-prepare>>  file:"+file.subpath);
    //console.log("resources-prepare>>  count:"+count);
    //if(count ===61){
    //    console.log("callTimes = "+JSON.stringify(callTimes,null,4));
    //}

    //对配置项做填充
    utils.merge(defaultSettings,settings,false);

    //console.log("settings: ["+JSON.stringify(settings)+"]");

    // 对js资源进行预处理
    if (file.isJsLike) {
        console.log("resources-prepare>>  file:"+file.subpath+" is isJsLike");
        //保存文件的moduleId
        var fileModuleId= getModuleIdForDefine(file,false);

        if(file.needWrap){
            content= wrapJsModule(file,content,fileModuleId)
        }
        else{
            //todo:2015-09-23 查看原文中是否已经有define和alia了，在这里可以提前生成alia(但是考虑到一些第三方库本身有define的时候并
            // 不一定是我想要的moduleId,且存在if else分支里，所以暂时不做)
        }
        return content;
    }
    //对html文件资源进行预处理
    else if(file.isHtmlLike){
        console.log("resources-prepare>>  file:"+file.subpath+" is isHtmlLike");
        //分析页面，查找link[rel=component]
        var $ = cheerio.load(content);

        //对页面js模块进行包裹
        dependency.updateInlineScriptsContentInHtml($, function (script) {
            //保存文件的moduleId
            var fileModuleId= getModuleIdForDefine(file,true);
            var wrapped = wrapJsModule(file,script,fileModuleId);
            return wrapped;
        });


        //处理页面上的component嵌入逻辑
        dealwithComponentEmbed(file,$,settings);




        if (file.isViews) {
            console.log('file:'+file.subpath+'判断是否需要添加前置脚本，加在置底脚本的最前面：\r\n');
            //判断是否需要添加前置脚本，加在置底脚本的最前面
            addPredefineScript(file,$,settings);
        }

        //给所有页面的脚本添加 jspath 属性
        addScriptsJsPath(file,$);

        return $.html();
    }else{
        return content;
    }
}

