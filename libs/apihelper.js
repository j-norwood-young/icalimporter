const config = require('config');
const axios = require("axios");

function displayError(err) {
	console.error(`${ new Date().toISOString() }\turl: ${err.config.url}\tmethod: ${ err.request.method}\tstatus: ${err.response.status}\tstatusText: ${err.response.statusText}\tdata: ${ (err.response.data) ? JSON.stringify(err.response.data) : 'No data' }`);
}

var APIHelper = function(opts) {
	const self = this;
	self.api = config.apiserver + "/api";
	self.api_root = config.apiserver;

	self.config = opts => {
		var self = this;
		console.log("Opts", opts);
		for (var opt in opts) {
			self[opt] = opts[opt];
		}
	};

	self.config(opts);

	var _configParams = opts => {
		opts = opts || {};
		opts.apikey = self.apikey;
		var parts = [];
		for (var opt in opts) {
			if (Array.isArray(opts[opt])) {
				opts[opt].forEach(val => {
					parts.push(opt + "=" + val);
				});
			} else {
				parts.push(opt + "=" + opts[opt]);
			}
		}
		return parts.join("&");
	};

	self.setup = (req, res, next) => {
		req.apihelper = new APIHelper({ apikey: req.session.apikey });
		next();
	};

	self.url = (type, opts) => {
		return self.api + "/" + type + "?" + _configParams(opts);
	};

	self.getOne = async (type, id, opts) => {
		console.time("getOne." + type);
		var url = self.api + "/" + type + "/" + id + "?" + _configParams(opts);
		try {
			var result = await axios.get(url);
			console.timeEnd("getOne." + type);
			if (result.status !== 200) {
				throw(result.statusText);
			}
			return result.data;
		} catch(err) {
			displayError(err);
			throw(err.response ? err.response.data : err);
		}
	};

	self.get = async (type, opts) => {
		console.time("get." + type);
		var url = self.url(type, opts);
		try {
			var result = await axios.get(url);
			console.timeEnd("get." + type);
			if (result.status !== 200) {
				throw(result.statusText);
			}
			return result.data;
		} catch(err) {
			displayError(err);
			throw(err.response ? err.response.data : err);
		}
	};

	self.post = async (type, data) => {
		var url = self.api + "/" + type + "?apikey=" + self.apikey;
		console.log("POSTing to ", url, data);
		try {
			return (await axios.post(url, data)).data;
		} catch(err) {
			displayError(err);
			throw(err.response ? err.response.data : err);
		}
	};

	self.put = async (type, id, data) => {
		var url = self.api + "/" + type + "/" + id + "?apikey=" + self.apikey;
		console.log("PUTting to ", url, data);
		try {
			return (await axios.put(url, data)).data;
		} catch(err) {
			displayError(err);
			throw(err.response ? err.response.data : err);
		}
	};

	self.postput = async (type, key, data) => {
		// Post if we find key=id, else put
		var self = this;
		var obj = {};
		obj["filter[" + key + "]"] = data[key];
		try {
			var result = await self.get(type, obj);
			if (result.count) {
				var id = result.data[0]._id;
				return self.put(type, id, data);
			} else {
				return self.post(type, data);
			}
		} catch(err) {
			displayError(err);
			throw(err.response ? err.response.data : err);
		}
	};

	self.del = async (type, id) => {
		var url = self.api + "/" + type + "/" + id + "?apikey=" + self.apikey;
		try {
			return (await axios.delete(url)).data;
		} catch(err) {
			displayError(err);
			throw(err.response ? err.response.data : err);
		}
	};

	// This should be rewritten as an async pattern
	self.delAll = (type, key, id) => {
		var self = this;
		var obj = {};
		obj["filter[" + key + "]"] = id;
		return self.get(type, obj)
		.then(function(result) {
			var queue = [];
			if (result.count === 0)
				return true;
			result.data.forEach(function(row) {
				console.log("Found", row);
				queue.push(function() {
					console.log("Deleting id", row._id);
					return self.del(type, row._id);
				});
			});
			return queue.reduce(function(soFar, f) {
				return soFar.then(f);
			}, Q());
		});
	};

	// This should be rewritten as an async pattern
	self.sync = (type, key, id, data) => {
		// Given the records filtered by key = id, we create, update or delete until we are in sync with data.
		var obj = {};
		obj["filter[" + key + "]"] = id;
		return self.get(type, obj)
		.then(function(result) {
			var data_ids = data.filter(function(row) {
				return (row._id);
			}).map(function(row) {
				return row._id;
			});
			var dest_ids = result.data.map(function(row) {
				return row._id;
			});
			// console.log("data_ids", data_ids);
			// console.log("dest_ids", dest_ids);
			var deletes = dest_ids.filter(function(n) {
				return data_ids.indexOf(n) == -1;
			}) || [];
			var moreinserts = data_ids.filter(function(n) {
				return (dest_ids.indexOf(n) == -1);
			}) || [];
			var inserts = data.filter(function(row) {
				return (moreinserts.indexOf(row._id) != -1) || !(row._id);
			});
			var update_ids = dest_ids.filter(function(n) {
				return data_ids.indexOf(n) != -1;
			}) || [];
			var updates = data.filter(function(row) {
				return update_ids.indexOf(row._id) != -1;
			}) || [];
			var queue = [];
			inserts.forEach(function(insert_data) {
				queue.push(function() {
					console.log("Inserting");
					self.post(type, insert_data);
				});
			});
			updates.forEach(function(update_data) {
				queue.push(function() {
					console.log("Updating");
					self.put(type, update_data._id, update_data);
				});
			});
			deletes.forEach(function(delete_id) {
				queue.push(function() {
					console.log("Deleting");
					self.del(type, delete_id);
				});
			});
			return queue.reduce(function(soFar, f) {
				return soFar.then(f);
			}, Q());
		});
	};

	self.call = async (type, cmd, data) => {
		//Call a function in the model
		var url = self.api_root + "/call/" + type + "/" + cmd + "?apikey=" + self.apikey;
		console.log("CALLing  ", url, data);
		try {
			return (await axios.post(url, data)).data;
		} catch(err) {
			throw(err.response ? err.response.data : err);
		}
	};

	self.groups_put = async (user_id, groups) => {
		var url = self.api_root + "/groups/" + user_id + "?apikey=" + self.apikey;
		try {
			return (await axios.put(url, { group: groups })).data;
		} catch(err) {
			throw(err.response ? err.response.data : err);
		}
	};

	self.groups_del = async (user_id, group) => {
		var url = `${self.api_root}/groups/${user_id}?group=${group}&apikey=${self.apikey}`;
		try {
			return (await axios.delete(url)).data;
		} catch(err) {
			displayError(err);
			throw(err.response ? err.response.data : err);
		}
	};

	self.groups_post = async (user_id, groups) => {
		var url = self.api_root + "/groups/" + user_id + "?apikey=" + self.apikey;
		var data = { group: groups };
		console.log("GROUP POSTing  ", url, data);
		try {
			return (await axios.post(url, data)).data;
		} catch(err) {
			displayError(err);
			throw(err.response ? err.response.data : err);
		}
	};

	self.getLocations = (req, res, next) => {
		self.get("location")
		.then(function(locations) {
			res.locals.locations = locations.data;
			return next();
		}, function(err) {
			displayError(err);
			return res.send(err);
		});
	};

	self.getMemberships = (req, res, next) => {
		self.get("membership")
		.then(function(result) {
			res.locals.memberships = result.data;
			return next();
		}, function(err) {
			displayError(err);
			return res.send(err);
		});
	};

	self.getMembers = (req, res, next) => {
		self.get("user", { "filter[status]": "active" })
		.then(function(result) {
			res.locals.members = result.data;
			return next();
		}, function(err) {
			displayError(err);
			return res.send(err);
		});
	};

	self.getOrganisations = (req, res, next) => {
		self.get("organisation", { "filter[status]": "active" })
		.then(function(result) {
			res.locals.organisations = result.data;
			return next();
		}, function(err) {
			displayError(err);
			return res.send(err);
		});
	};
};

module.exports = APIHelper;
