import * as d3 from "d3";
export { DependencyModelFactory, DependencyModel };

const DependencyModelFactory = (function() {
    return {
        getInstance: function(archive_url, downloads_url) {
            const model = new DependencyModel(archive_url, downloads_url);
            return model.done.then(_ => model);
        }
    };
})();

class DependencyModel {
    constructor(archive_url = "archive.json",
                downloads_url = "download_counts.json") {
        
        const archive_promise = d3.json(archive_url);
        const download_promise = d3.json(downloads_url);

        this.done = Promise.all([archive_promise, download_promise])
                           .then(this.generateGraph.bind(this));
    }

    get nodes() { return this.node_list; }
    get links() { return this.link_list; }
    
    /**
     * Returns a filtered node list and link list
     */
    getFilteredResults(filters) {
        const search = filters.search;
        const downloads = filters.downloads;
        const dnotnull = filters.dnotnull;
        let metric_range = [0,1];

        console.log(dnotnull);

        let nodes = Object.keys(this.index);;

        if(search !== "" && search in this.index) {
            const results = this.computeDistances(search, filters.dependencies, filters.descendants);
            nodes = results.visited;
            metric_range = results.range;
        } else if (search !== "") {
            nodes = [];
        }

        nodes = nodes.filter(name => {
            if (this.index[name]["downloads"] != null && this.index[name]["downloads"] >= downloads)
                return true;

            if (this.index[name]["downloads"] == null && dnotnull === false)
                return true;

            return false;
        }, this);

        const test = {};
        nodes.forEach(name => test[name] = this.index[name], this);

        const links = this.links.filter((link, index) => {
            return (link.source.name in test) && (link.target.name in test);
        });

        console.debug("model:" + metric_range);
        
        return { nodes: Object.values(test) , links, metric_range, search};
    }

    getAncestors(name) {
        const visited = {};
        visited[name] = true;

        // FIFO
        const queue = [name];
        while (queue.length > 0) {
            const current = queue.shift();

            this.index[current].parents.forEach(parent => {
                if(!(parent in visited)) {
                    visited[parent] = true;
                    queue.push(parent);
                }
            });
        }

        return Object.keys(visited);
    }

    getDescendants(name) {
        const visited = {};
        visited[name] = true;

        // FIFO
        const queue = [name];
        while (queue.length > 0) {
            const current = queue.shift();

            this.index[current].children.forEach(child => {
                if(!(child in visited)) {
                    visited[child] = true;
                    queue.push(child);
                }
            });
        }

        return Object.keys(visited);
    }

    generateGraph(responses) {
        this.generateNodes(responses);
        this.generateLinks();
    }
    
    generateNodes(responses) {
        const packages = responses[0];
        const downloads = responses[1];

        this.index = {};
        this.node_list = Object.keys(packages).map(name => {
            this.index[name] = this.generateNode(name, packages[name]);
            return this.index[name];
        });

        const tmp = [];
        
        this.node_list.forEach(node => {

            // Some packages come with deps outside of MELPA
            node.parents.forEach(parent => {
                if (!(parent in this.index)) {
                    this.index[parent] = {
                        name: parent,
                        desc: "A package not listed in MELPA.",
                        keywords: [],
                        parents: [],
                        children: [],
                        distances: {}
                    };

                    tmp.push(this.index[parent]);
                }

                this.index[parent].children.push(node.name);
            }, this);
            
            if (node.name in downloads) this.index[node.name]["downloads"] = downloads[node.name];
            
        }, this);

        this.node_list = this.node_list.concat(tmp);
    }

    /**
     * @param {string} name
     * @param {Object} element
     */
    generateNode(name, element) {
        let authors = null;
        let keywords = [];
        let parents = [];

        if (element["props"] !== null) {
            authors = element["props"]["authors"];
            keywords = element["props"]["keywords"];
        }

        if (element["deps"] !== null) {
            parents = Object.keys(element["deps"]);
        }
            
        return {
            name,
            desc: element["desc"],
            authors,
            keywords,
            parents,
            children: [],
            distances: {}
        };
    }

    /**
     * Generate links based on this.nodes and this.index
     */
    generateLinks() {
        this.link_list = [];

        this.node_list.forEach(target => {
            target.parents.forEach(source => {
                this.link_list.push({
                    source: this.index[source],
                    target: target
                });
            }, this);
        }, this);
    }

    computeDistances(source, travel_parents, travel_children) {
        let layerParents = [this.index[source]];
        let layerChildren = [this.index[source]];
        const visited = new Set([source]);

        for(const node of this.node_list) {
            node.distances[source] = null;
        }

        this.index[source].distances[source] = 0;

        let counter = 0;
        if(travel_parents) {
            while(layerParents.length > 0) {
                counter++;
                const next = [];
                for(const node of layerParents) {
                    for(const parent of node.parents) {
                        if(!visited.has(parent)) {
                            this.index[parent].distances[source] = counter;
                            next.push(this.index[parent]);
                            visited.add(parent);
                        }
                    }
                }
                layerParents = next;
            }
        }
        let max_dist = counter - 1;

        counter = 0;
        if(travel_children) {
            while(layerChildren.length > 0) {
                counter++;
                const next = [];
                for(const node of layerChildren) {
                    for(const child of node.children) {
                        const child_node = this.index[child];
                        if(!visited.has(child)) {
                            child_node.distances[source] = counter;
                            next.push(child_node);
                            visited.add(child);
                        } else if(child_node.distances[source] >= counter) {
                            child_node.distances[source] = counter;
                            next.push(child_node);
                        }
                    }
                }
                layerChildren = next;
            }
        }
        max_dist = Math.max(max_dist, counter - 1);
        
        return {visited: Array.from(visited), range: [0, max_dist]};
    }

}
