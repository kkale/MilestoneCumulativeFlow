Ext.define('MilestoneCFD', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    margin: '10px',

    layout: {
        type: 'vbox',
        align: 'stretch'
    },

    items: [
        {
            xtype: 'container',
            itemId: 'header',
            layout: {
                type: 'hbox',
                align: 'stretch'
            }
        }
    ],

    launch: function () {
        this.down('#header').add({
            xtype: 'rallymilestonecombobox',
            width: 200,
            height: 22,
            stateful: true,
            stateId: this.getContext().getScopedStateId('milestone'),
            context: this.getContext(),
            listeners: {
                ready: this._load,
                select: this._load,
                scope: this
            }
        });
    },

    _load: function() {
        Deft.Promise.all([
            this._loadMilestone(),
            this._loadPIsInMilestone(),
            this._loadScheduleStateValues(),
        ]).then({
            success: function() {
                this._addProjectCheckboxes();
                this._addChart();
            },
            scope: this
        });
    },

    _getMilestone: function() {
        return this.down('rallymilestonecombobox').getValue();
    },

    _loadMilestone: function() {
        var milestoneId = Rally.util.Ref.getOidFromRef(this._getMilestone());
        return Rally.data.ModelFactory.getModel({
            type: 'Milestone',
            success: function (model) {
                model.load(milestoneId, {
                    fetch: ['TargetDate'],
                    callback: function (record) {
                        this.milestone = record;
                    },
                    scope: this
                });
            },
            scope: this
        });
    },

    _loadPIsInMilestone: function() {
        return Ext.create('Rally.data.wsapi.Store', {
            model: 'TypeDefinition',
            fetch: ['TypePath'],
            filters: [
                {
                    property: 'Parent.Name',
                    value: 'Portfolio Item'
                },
                {
                    property: 'Ordinal',
                    value: 0
                }
            ]
        }).load().then({
            success: function(records) {
                this.piType = records[0].get('TypePath');
                return Ext.create('Rally.data.wsapi.Store', {
                    model: this.piType,
                    fetch: ['ObjectID', 'Project', 'Name', 'PreliminaryEstimate', 'ActualStartDate', 'PlannedEndDate', 'AcceptedLeafStoryPlanEstimateTotal', 'LeafStoryPlanEstimateTotal'],
                    filters: [
                        {
                            property: 'Milestones',
                            operator: 'contains',
                            value: this._getMilestone()
                        }
                    ],
                    context: {
                        project: null
                    },
                    limit: Infinity
                }).load().then({
                    success: function(piRecords) {
                        this.piRecords = piRecords;
                    },
                    scope: this
                });
            },
            scope: this
        });
    },

    _loadScheduleStateValues: function () {
        return Rally.data.ModelFactory.getModel({
            type: 'UserStory',
            success: function (model) {
                model.getField('ScheduleState').getAllowedValueStore().load({
                    callback: function (records) {
                        this.scheduleStateValues = _.invoke(records, 'get', 'StringValue');
                    },
                    scope: this
                });
            },
            scope: this
        });
    },

    _addProjectCheckboxes: function() {
        if(this.down('checkboxgroup')) {
            this.down('checkboxgroup').destroy();
        }
        var teams = _.reduce(this.piRecords, function(projects, piRecord) {
            projects[Rally.util.Ref.getOidFromRef(piRecord.get('Project'))] = piRecord.get('Project');
            return projects;
        }, {});
        this.down('#header').add({
            xtype: 'checkboxgroup',
            margin: '0 0 0 20px',
            height: 22,
            flex: 1,
            items: _.map(_.values(teams), function(team) {
                return { boxLabel: team.Name, name: 'project', inputValue: Rally.util.Ref.getOidFromRef(team), checked: true };
            }),
            listeners: {
                change: this._addChart,
                scope: this
            }
        });
    },

    _addChart: function () {
        if(this.down('rallychart')) {
            this.down('rallychart').destroy();
        }
        this.add({
            xtype: 'rallychart',
            flex: 1,
            storeType: 'Rally.data.lookback.SnapshotStore',
            storeConfig: this._getStoreConfig(),
            calculatorType: 'CFDCalculator',
            calculatorConfig: {
                stateFieldName: 'ScheduleState',
                stateFieldValues: this.scheduleStateValues,
                startDate: _.min(_.compact(_.invoke(this.piRecords, 'get', 'ActualStartDate'))),
                endDate: this.milestone.get('TargetDate'),
                enableProjects: true
            },
            chartConfig: this._getChartConfig()
        });
    },

    _getStoreConfig: function () {
        return {
            find: {
                _TypeHierarchy: { '$in': [ 'HierarchicalRequirement'] },
                _ItemHierarchy: { '$in': _.invoke(this.piRecords, 'getId')},
                _ProjectHierarchy: { '$in': Ext.Array.from(this.down('checkboxgroup').getValue().project)}
            },
            fetch: ['ScheduleState', 'PlanEstimate', 'PortfolioItem', 'LeafStoryPlanEstimateTotal', 'State'],
            hydrate: ['ScheduleState', 'State'],
            sort: {
                _ValidFrom: 1
            },
            context: this.getContext().getDataContext(),
            limit: Infinity
        };
    },

    /**
     * Generate a valid Highcharts configuration object to specify the chart
     */
    _getChartConfig: function () {
        var totalAcceptedPoints = _.reduce(this.piRecords, function(total, piRecord) {
            return total + piRecord.get('AcceptedLeafStoryPlanEstimateTotal');
        },  0);
        var totalPoints = _.reduce(this.piRecords, function(total, piRecord) {
            return total + piRecord.get('LeafStoryPlanEstimateTotal');
        },  0, this);

        return {
            chart: {
                zoomType: 'xy'
            },
            title: {
                text: 'Milestone Cumulative Flow'
            },
            subtitle: {
                text: Ext.Number.toFixed(((totalAcceptedPoints / totalPoints) * 100), 2) + ' % of ' + totalPoints + ' Total Points Completed'
            },
            xAxis: {
                tickmarkPlacement: 'on',
                tickInterval: 15,
                title: {
                    text: 'Date'
                }
            },
            yAxis: [
                {
                    title: {
                        text: 'Points'
                    }
                }
            ],
            plotOptions: {
                series: {
                    marker: {
                        enabled: false
                    }
                },
                area: {
                    stacking: 'normal'
                }
            }
        };
    }
});
